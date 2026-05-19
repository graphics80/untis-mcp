#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as dotenv from 'dotenv';
import { UntisClient } from './untis-client.js';
import { registerHandlers } from './mcp-handlers.js';

dotenv.config();

const untisClient = new UntisClient(process.env.SCHOOL_TIMEZONE || 'Europe/Vienna');

const server = new Server(
  { name: 'untis-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

registerHandlers(server, untisClient);

async function main(): Promise<void> {
  const school = process.env.WEBUNTIS_SCHOOL;
  const username = process.env.WEBUNTIS_USERNAME;
  const password = process.env.WEBUNTIS_PASSWORD;
  const baseUrl = process.env.WEBUNTIS_BASE_URL;

  if (!school || !username || !password || !baseUrl) {
    process.stderr.write('Missing required environment variables: WEBUNTIS_SCHOOL, WEBUNTIS_USERNAME, WEBUNTIS_PASSWORD, WEBUNTIS_BASE_URL\n');
    process.exit(1);
  }

  try {
    await untisClient.initialize(school, username, password, baseUrl);
    process.stderr.write('WebUntis client initialized\n');

    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('MCP server running on stdio\n');
  } catch (error) {
    process.stderr.write(`Failed to start server: ${error}\n`);
    process.exit(1);
  }
}

main();
