import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { ChatResult } from '@langchain/core/outputs';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';

// ─── IBM IAM token cache (per API key) ───────────────────────────────────────

const iamTokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getIbmIamToken(apiKey: string): Promise<string> {
	const cached = iamTokenCache.get(apiKey);
	const now = Date.now();

	if (cached && cached.expiresAt > now + 60_000) {
		return cached.token;
	}

	const response = await fetch('https://iam.cloud.ibm.com/identity/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
			apikey: apiKey,
		}).toString(),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`IBM IAM token exchange failed: ${response.status} - ${text}`);
	}

	const data = (await response.json()) as { access_token: string; expires_in?: number };

	const entry = {
		token: data.access_token,
		expiresAt: now + (data.expires_in ?? 3600) * 1000,
	};
	iamTokenCache.set(apiKey, entry);

	return entry.token;
}

// ─── Simple JSONPath extractor ────────────────────────────────────────────────
// Handles: $.choices[0].message.content  or  choices[0].message.content

function extractByPath(data: unknown, path: string): unknown {
	const clean = path.replace(/^\$\.?/, '');
	if (!clean) return data;

	const parts = clean.split(/[\.\[\]]+/).filter(Boolean);
	let current: unknown = data;

	for (const part of parts) {
		if (current === null || current === undefined) return undefined;
		const index = Number(part);
		current = isNaN(index)
			? (current as Record<string, unknown>)[part]
			: (current as unknown[])[index];
	}

	return current;
}

// ─── Config & model ───────────────────────────────────────────────────────────

export interface RestChatModelConfig {
	endpoint: string;
	authHeaders: Record<string, string>;
	mode: 'stateless' | 'stateful';
	sessionId?: string;
	bodyTemplate: unknown; // parsed JSON object (placeholders inside strings)
	responsePath: string;
	modelId: string;
	additionalHeaders: Record<string, string>;
	injectHistory: boolean;
	maxRetries: number;
	debugMode: boolean;
}

// ─── Header masking (debug mode) ─────────────────────────────────────────────

function maskHeaders(headers: Record<string, string>): Record<string, string> {
	const masked: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const lower = key.toLowerCase();
		if (lower === 'authorization') {
			masked[key] = value.startsWith('Bearer ') ? 'Bearer ***' : '***';
		} else if (lower === 'iam-api_key') {
			masked[key] = '***';
		} else {
			masked[key] = value;
		}
	}
	return masked;
}

function toRole(message: BaseMessage): string {
	const type = message._getType();
	if (type === 'human') return 'user';
	if (type === 'ai') return 'assistant';
	return type; // 'system', 'tool', etc.
}

function contentToString(content: BaseMessage['content']): string {
	if (typeof content === 'string') return content;
	return JSON.stringify(content);
}

export class RestChatModel extends BaseChatModel {
	private cfg: RestChatModelConfig;

	constructor(config: RestChatModelConfig) {
		super({});
		this.cfg = config;
	}

	_llmType(): string {
		return 'generic-rest';
	}

	// no-op: prevents the AI Agent from injecting tool definitions into the payload
	bindTools(_tools: unknown[]): this {
		return this;
	}

	async _generate(
		messages: BaseMessage[],
		_options: this['ParsedCallOptions'],
		_runManager?: CallbackManagerForLLMRun,
	): Promise<ChatResult> {
		const payload = this.buildPayload(messages);

		const requestHeaders: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...this.cfg.authHeaders,
			...this.cfg.additionalHeaders,
		};

		const maxAttempts = this.cfg.maxRetries + 1;
		let lastNetworkError: (Error & { cause?: Error }) | undefined;
		let response: Response | undefined;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				response = await fetch(this.cfg.endpoint, {
					method: 'POST',
					headers: requestHeaders,
					body: JSON.stringify(payload),
					signal: AbortSignal.timeout(60_000), // 60 s timeout
				});
				lastNetworkError = undefined;
				break; // success — exit retry loop
			} catch (e) {
				lastNetworkError = e as Error & { cause?: Error };
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 1_000 * Math.pow(2, attempt - 1)));
				}
			}
		}

		if (lastNetworkError || !response) {
			const err = lastNetworkError!;
			const causeMsg = err.cause ? ` (cause: ${err.cause.message})` : '';
			throw new Error(
				`REST Chat Model network error — ${err.message}${causeMsg} — endpoint: ${this.cfg.endpoint}`,
			);
		}

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`REST Chat Model call failed: ${response.status} ${response.statusText} — ${text}`,
			);
		}

		const data: unknown = await response.json();
		const text = extractByPath(data, this.cfg.responsePath);

		if (typeof text !== 'string') {
			throw new Error(
				`Response path "${this.cfg.responsePath}" did not return a string. Got: ${JSON.stringify(text)}`,
			);
		}

		const message = this.cfg.debugMode
			? new AIMessage({
					content: text,
					response_metadata: {
						debug: {
							request: {
								endpoint: this.cfg.endpoint,
								headers: maskHeaders(requestHeaders),
								body: payload,
							},
							response: {
								status: response.status,
								body: data,
							},
						},
					},
				})
			: new AIMessage(text);

		return {
			generations: [{ text, message }],
		};
	}

	private buildPayload(messages: BaseMessage[]): unknown {
		const formatted = messages.map((m) => ({
			role: toRole(m),
			content: contentToString(m.content),
		}));

		const lastUser = [...messages].reverse().find((m) => m._getType() === 'human');
		const lastMessage = contentToString(lastUser?.content ?? '');

		if (this.cfg.mode === 'stateful') {
			// Stateful: send only the last user message as a single-item array
			// (server manages full history internally via sessionId)
			const singleMessage = lastUser
				? [{ role: 'user', content: lastMessage }]
				: [];
			return this.interpolate(this.cfg.bodyTemplate, {
				messages: singleMessage,
				lastMessage,
				sessionId: this.cfg.sessionId ?? '',
				model: this.cfg.modelId,
			});
		}

		if (this.cfg.injectHistory && messages.length > 1) {
			// History injection: concatenate full conversation into the last user message.
			// Use this when the API ignores previous messages and only processes the last one.
			const historyLines = formatted
				.slice(0, -1) // all but the last message
				.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
				.join('\n');
			const injectedContent = `[Conversation History]\n${historyLines}\n\n[Current Message]\n${lastMessage}`;
			const singleMessage = [{ role: 'user', content: injectedContent }];
			return this.interpolate(this.cfg.bodyTemplate, {
				messages: singleMessage,
				lastMessage: injectedContent,
				sessionId: this.cfg.sessionId ?? '',
				model: this.cfg.modelId,
			});
		}

		return this.interpolate(this.cfg.bodyTemplate, {
			messages: formatted,
			lastMessage,
			sessionId: this.cfg.sessionId ?? '',
			model: this.cfg.modelId,
		});
	}

	/**
	 * Deep-traverses a parsed JSON object and replaces {{placeholder}} strings.
	 * - If a string IS exactly "{{key}}", the entire value is replaced with the
	 *   variable (preserving objects/arrays — e.g. the messages array).
	 * - Otherwise, {{key}} inside a larger string is replaced with its string
	 *   representation.
	 */
	private interpolate(node: unknown, vars: Record<string, unknown>): unknown {
		if (typeof node === 'string') {
			// Exact match — return the raw value (can be array/object)
			const exact = node.match(/^\{\{(\w+)\}\}$/);
			if (exact) {
				const val = vars[exact[1]];
				return val !== undefined ? val : node;
			}
			// Inline replacement (string values only)
			return node.replace(/\{\{(\w+)\}\}/g, (_, k) => {
				const val = vars[k];
				if (val === undefined) return `{{${k}}}`;
				return typeof val === 'object' ? JSON.stringify(val) : String(val);
			});
		}
		if (Array.isArray(node)) return node.map((item) => this.interpolate(item, vars));
		if (node !== null && typeof node === 'object') {
			return Object.fromEntries(
				Object.entries(node as Record<string, unknown>).map(([k, v]) => [
					k,
					this.interpolate(v, vars),
				]),
			);
		}
		return node;
	}
}
