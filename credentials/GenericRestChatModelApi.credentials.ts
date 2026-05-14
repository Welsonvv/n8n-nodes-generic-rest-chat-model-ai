import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class GenericRestChatModelApi implements ICredentialType {
	name = 'genericRestChatModelApi';
	displayName = 'Generic REST Chat Model API';
	documentationUrl = '';
	properties: INodeProperties[] = [
		{
			displayName: 'Authentication Type',
			name: 'authType',
			type: 'options',
			options: [
				{
					name: 'IBM IAM (watsonx Orchestrator)',
					value: 'ibmIam',
					description: 'Exchanges IBM API Key for a Bearer token via IAM automatically',
				},
				{
					name: 'Bearer Token',
					value: 'bearerToken',
					description: 'Static Bearer token in Authorization header',
				},
				{
					name: 'API Key Header',
					value: 'apiKeyHeader',
					description: 'Custom header with API key',
				},
				{
					name: 'None',
					value: 'none',
					description: 'No authentication headers',
				},
			],
			default: 'ibmIam',
		},
		// IBM IAM
		{
			displayName: 'IBM API Key',
			name: 'ibmApiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: {
				show: { authType: ['ibmIam'] },
			},
			description:
				'IBM Cloud API Key. Automatically exchanged for a Bearer token via iam.cloud.ibm.com (token cached for 1h).',
		},
		// Bearer Token
		{
			displayName: 'Bearer Token',
			name: 'bearerToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: {
				show: { authType: ['bearerToken'] },
			},
		},
		// API Key Header
		{
			displayName: 'Header Name',
			name: 'headerName',
			type: 'string',
			default: 'X-API-Key',
			required: true,
			displayOptions: {
				show: { authType: ['apiKeyHeader'] },
			},
		},
		{
			displayName: 'Header Value',
			name: 'headerValue',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: {
				show: { authType: ['apiKeyHeader'] },
			},
		},
	];
}
