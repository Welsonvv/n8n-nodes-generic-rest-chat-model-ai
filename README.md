# n8n-nodes-generic-rest-chat-model-AI

A community sub-node that plugs any REST-based LLM into the n8n **AI Agent** as a Chat Model — without writing code or creating a custom node for each API.

Supports IBM watsonx Orchestrator, Ollama, Groq, and any OpenAI-compatible REST endpoint.

---

## How it works

The node acts as a **Chat Model sub-node** (the same slot used by the built-in OpenAI or Anthropic nodes). It sends the conversation history to a REST endpoint using a configurable JSON body template and extracts the reply using a JSONPath expression.

```
AI Agent ──► Generic REST Chat Model ──► Your REST API
               ↑
        Simple Memory (optional)
```

---

## Installation

In your n8n instance, go to **Settings → Community Nodes → Install** and enter:

```
@welsonviana/n8n-nodes-generic-rest-chat-model-AI
```

Or in a self-hosted Docker instance:

```bash
docker exec -it n8n npm install @welsonviana/n8n-nodes-generic-rest-chat-model-AI
```

---

## Credentials

Create a **Generic REST Chat Model API** credential and choose one of the auth types:

| Auth Type | When to use |
|---|---|
| **IBM IAM** | IBM watsonx Orchestrator — exchanges your IBM API Key for a Bearer token automatically (cached with TTL) |
| **Bearer Token** | Groq, OpenRouter, or any API that uses `Authorization: Bearer <token>` |
| **API Key Header** | APIs that use a custom header (e.g. `X-Api-Key`) |
| **None** | Ollama or any unauthenticated local endpoint |

---

## Node parameters

| Parameter | Description |
|---|---|
| **Endpoint URL** | Full POST URL of the LLM endpoint |
| **Model / Agent ID** | Injected as `{{model}}` in the body template |
| **Stateful Mode** | Send only the last message + session ID (server manages history). When enabled, set Simple Memory's Context Window Length to 1 |
| **Session ID** | Injected as `{{sessionId}}` — visible only when Stateful Mode is on |
| **Inject History Into Message** | Concatenates the full conversation history into the last user message as plain text. Use when the API ignores the `messages` array (e.g. watsonx Orchestrator) |
| **Request Body Template** | JSON template with placeholders (see below) |
| **Response Path** | JSONPath to the text field in the API response (e.g. `$.choices[0].message.content`) |
| **Debug Mode** | Attaches the raw request and response to the execution output (AI panel). Sensitive headers are masked. Disable in production |
| **Max Retries** | Automatic retries on transient network errors with exponential backoff (1 s, 2 s, 4 s). HTTP errors are never retried. Default: 2 |
| **Additional Headers** | Extra HTTP headers as a JSON object |

### Body template placeholders

| Placeholder | Replaced with |
|---|---|
| `{{messages}}` | Full messages array `[{ role, content }, ...]` |
| `{{lastMessage}}` | Last user message as a string |
| `{{sessionId}}` | Session ID (stateful mode) |
| `{{model}}` | Model / Agent ID |

A placeholder that is the **sole value** of a JSON string (e.g. `"messages": "{{messages}}"`) is replaced with the raw value, injecting the array directly into the body.

---

## Examples

### Ollama (local, no auth)

**Credential:** None

**Endpoint URL:**
```
http://host.docker.internal:11434/api/chat
```

**Body Template:**
```json
{
  "model": "{{model}}",
  "stream": false,
  "messages": "{{messages}}"
}
```

**Model / Agent ID:** `llama3`

**Response Path:** `$.message.content`

---

### Groq (Bearer Token)

**Credential:** Bearer Token → your Groq API key

**Endpoint URL:**
```
https://api.groq.com/openai/v1/chat/completions
```

**Body Template:**
```json
{
  "model": "{{model}}",
  "stream": false,
  "messages": "{{messages}}"
}
```

**Model / Agent ID:** `llama-3.3-70b-versatile`

**Response Path:** `$.choices[0].message.content`

---

### IBM watsonx Orchestrator (IBM IAM + Inject History)

**Credential:** IBM IAM → your IBM API Key

**Endpoint URL:**
```
https://api.br-sao.watson-orchestrate.cloud.ibm.com/instances/{instanceId}/v1/orchestrate/{agentId}/chat/completions
```

**Body Template:**
```json
{
  "model": "{{model}}",
  "stream": false,
  "messages": "{{messages}}",
  "additional_properties": {}
}
```

**Model / Agent ID:** your Agent ID (same as the one in the URL)

**Inject History Into Message:** enabled

**Response Path:** `$.choices[0].message.content`

> watsonx Orchestrator ignores the `messages` array for context. Enabling **Inject History Into Message** concatenates the full conversation history into the last user message so the agent receives it.

---

## License

MIT
