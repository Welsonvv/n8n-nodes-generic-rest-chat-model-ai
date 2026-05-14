import {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	NodeConnectionTypes,
	SupplyData,
} from 'n8n-workflow';
import { getIbmIamToken, RestChatModel, RestChatModelConfig } from './RestChatModel';

const DEFAULT_BODY_TEMPLATE = JSON.stringify(
	{
		model: '{{model}}',
		stream: false,
		messages: '{{messages}}',
		additional_properties: {},
	},
	null,
	2,
);

export class GenericRestChatModel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NodeRestChatModelAi',
		name: 'genericRestChatModel',
		icon: 'file:restChatModelAi.svg',
		group: ['transform'],
		version: 1,
		description:
			'Use any REST-based LLM (IBM watsonx Orchestrator, Ollama, Groq, custom APIs) as a Chat Model inside the n8n AI Agent.',
		defaults: {
			name: 'NodeRestChatModelAi',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models'],
			},
			resources: {},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'genericRestChatModelApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Endpoint URL',
				name: 'endpointUrl',
				type: 'string',
				default: '',
				placeholder:
					'https://api.br-sao.watson-orchestrate.cloud.ibm.com/instances/{id}/v1/orchestrate/{agent_id}/chat/completions',
				required: true,
				description: 'Full POST URL of the LLM REST endpoint',
			},
			{
				displayName: 'Model / Agent ID',
				name: 'modelId',
				type: 'string',
				default: '',
				description:
					'Value injected as <code>{{model}}</code> in the body template. For watsonx Orchestrator this is the Agent ID.',
			},
			{
				displayName: 'Stateful Mode (Session ID)',
				name: 'stateful',
				type: 'boolean',
				default: false,
				description:
					'Whether to send only the last message + session ID instead of the full history. Enable when the server manages conversation state internally. When enabled, set Simple Memory\'s <b>Context Window Length to 1</b> — history is managed by the server; accumulating it locally has no effect.',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '',
				displayOptions: {
					show: { stateful: [true] },
				},
				description:
					'Session or thread ID injected as <code>{{sessionId}}</code> in the body template.',
			},
			{
				displayName: 'Inject History Into Message',
				name: 'injectHistory',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: { stateful: [false] },
				},
				description:
					'Whether to concatenate the full conversation history into the last user message instead of using the messages array. Enable this when the API ignores previous messages (e.g. watsonx Orchestrator).',
			},
			{
				displayName: 'Request Body Template',
				name: 'bodyTemplate',
				type: 'json',
				default: DEFAULT_BODY_TEMPLATE,
				description:
					'JSON template for the request body. Placeholders: <code>{{messages}}</code> (full history array), <code>{{lastMessage}}</code> (last user message string), <code>{{sessionId}}</code>, <code>{{model}}</code>. A placeholder that is the sole value of a JSON string (e.g. <code>"{{messages}}"</code>) is replaced with the raw value, allowing arrays to be injected.',
			},
			{
				displayName: 'Response Path',
				name: 'responsePath',
				type: 'string',
				default: '$.choices[0].message.content',
				description:
					'JSONPath to the text string in the API response. Example: <code>$.choices[0].message.content</code>',
			},
			{
				displayName: 'Debug Mode',
				name: 'debugMode',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach the raw request and response to the execution output. Visible in the AI panel of the execution details. Sensitive headers (Authorization, IAM-API_KEY) are masked automatically. Disable in production.',
			},
			{
				displayName: 'Max Retries',
				name: 'maxRetries',
				type: 'number',
				default: 2,
				typeOptions: { minValue: 0, maxValue: 5 },
				description:
					'Number of automatic retries on transient network errors (ETIMEDOUT, ECONNRESET). Uses exponential backoff: 1 s, 2 s, 4 s… HTTP errors (4xx/5xx) are never retried.',
			},
			{
				displayName: 'Additional Headers',
				name: 'additionalHeaders',
				type: 'json',
				default: '{}',
				description: 'Extra HTTP headers to include (JSON object)',
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('genericRestChatModelApi');

		const endpointUrl = this.getNodeParameter('endpointUrl', itemIndex) as string;
		const modelId = this.getNodeParameter('modelId', itemIndex) as string;
		const stateful = this.getNodeParameter('stateful', itemIndex) as boolean;
		const mode: 'stateless' | 'stateful' = stateful ? 'stateful' : 'stateless';
		const sessionId = stateful ? (this.getNodeParameter('sessionId', itemIndex) as string) : undefined;
		const injectHistory = stateful ? false : (this.getNodeParameter('injectHistory', itemIndex) as boolean);
		const bodyTemplateRaw = this.getNodeParameter('bodyTemplate', itemIndex) as string;
		const responsePath = this.getNodeParameter('responsePath', itemIndex) as string;
		const maxRetries = this.getNodeParameter('maxRetries', itemIndex) as number;
		const debugMode = this.getNodeParameter('debugMode', itemIndex) as boolean;
		const additionalHeadersRaw = this.getNodeParameter('additionalHeaders', itemIndex) as string;

		// Parse body template — must be valid JSON
		let bodyTemplate: unknown;
		try {
			const raw = typeof bodyTemplateRaw === 'string' ? bodyTemplateRaw : JSON.stringify(bodyTemplateRaw);
			bodyTemplate = JSON.parse(raw);
		} catch (e) {
			throw new Error(`Invalid JSON in "Request Body Template": ${(e as Error).message}`);
		}

		// Parse additional headers
		let additionalHeaders: Record<string, string> = {};
		try {
			const raw =
				typeof additionalHeadersRaw === 'string'
					? additionalHeadersRaw
					: JSON.stringify(additionalHeadersRaw);
			additionalHeaders = JSON.parse(raw || '{}') as Record<string, string>;
		} catch {
			// silently ignore — headers are optional
		}

		// Build auth headers
		const authHeaders: Record<string, string> = {};
		const authType = credentials.authType as string;

		if (authType === 'ibmIam') {
			const token = await getIbmIamToken(credentials.ibmApiKey as string);
			authHeaders['Authorization'] = `Bearer ${token}`;
			authHeaders['IAM-API_KEY'] = credentials.ibmApiKey as string;
		} else if (authType === 'bearerToken') {
			authHeaders['Authorization'] = `Bearer ${credentials.bearerToken as string}`;
		} else if (authType === 'apiKeyHeader') {
			authHeaders[credentials.headerName as string] = credentials.headerValue as string;
		}

		const config: RestChatModelConfig = {
			endpoint: endpointUrl,
			authHeaders,
			mode,
			sessionId,
			bodyTemplate,
			responsePath,
			modelId,
			additionalHeaders,
			injectHistory,
			maxRetries,
			debugMode,
		};

		return { response: new RestChatModel(config) };
	}
}
