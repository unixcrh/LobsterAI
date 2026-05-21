import { describe, expect, test } from 'vitest';

import {
  normalizeFilePathForDedup,
  parseFileLinksFromMessage,
  parseFilePathsFromText,
  parseToolArtifact,
  parseToolResultMediaArtifacts,
} from './artifactParser';

describe('normalizeFilePathForDedup', () => {
  test('strips leading / before Windows drive letter', () => {
    expect(normalizeFilePathForDedup('/D:/path/file.html')).toBe('d:/path/file.html');
  });

  test('normalizes backslashes to forward slashes', () => {
    expect(normalizeFilePathForDedup('D:\\path\\file.html')).toBe('d:/path/file.html');
  });

  test('lowercases for case-insensitive comparison', () => {
    expect(normalizeFilePathForDedup('D:/Path/File.HTML')).toBe('d:/path/file.html');
  });

  test('handles Unix absolute paths unchanged (except lowercase)', () => {
    expect(normalizeFilePathForDedup('/home/user/file.html')).toBe('/home/user/file.html');
  });

  test('dedup matches: file:// derived path vs tool path', () => {
    const fromFileUrl = '/D:/new_ws_test_2/hello-slide.html';
    const fromTool = 'D:\\new_ws_test_2\\hello-slide.html';
    expect(normalizeFilePathForDedup(fromFileUrl)).toBe(normalizeFilePathForDedup(fromTool));
  });
});

describe('parseFileLinksFromMessage', () => {
  test('strips leading / from Windows file:// link path', () => {
    const content = '文件：[hello.pptx](file:///D:/workspace/hello.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/workspace/hello.pptx');
  });

  test('preserves Unix file:// link path', () => {
    const content = '[report.pdf](file:///home/user/report.pdf)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('/home/user/report.pdf');
  });

  test('handles URI-encoded paths', () => {
    const content = '[文件.pptx](file:///D:/my%20folder/%E6%96%87%E4%BB%B6.pptx)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/my folder/文件.pptx');
  });

  test('creates image artifacts for local file links', () => {
    const content = '[generated-image.png](file:///home/user/project/generated-image.png)';
    const artifacts = parseFileLinksFromMessage(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('image');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-image.png');
  });
});

describe('parseFilePathsFromText', () => {
  test('strips leading / after file:/// protocol removal on Windows', () => {
    const content = 'output at file:///D:/project/output.pdf done';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].filePath).toBe('D:/project/output.pdf');
  });

  test('creates image artifacts for bare local image paths', () => {
    const content = 'Saved generated image: /home/user/project/generated-image.webp';
    const artifacts = parseFilePathsFromText(content, 'msg1', 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('image');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-image.webp');
  });
});

describe('parseToolResultMediaArtifacts', () => {
  test('prefers local filePath for persisted generated images', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'system' as const,
      content: 'Saved generated image',
      timestamp: Date.now(),
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'image',
              url: 'https://example.com/generated.png?signature=temporary',
              filePath: '/home/user/project/generated-image.png',
              mimeType: 'image/png',
              filename: 'generated-image.png',
            },
          ],
        },
      },
    };
    const artifacts = parseToolResultMediaArtifacts(toolResultMsg, 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe('image');
    expect(artifacts[0].content).toBe('');
    expect(artifacts[0].filePath).toBe('/home/user/project/generated-image.png');
  });

  test('uses remote url when no local file path exists', () => {
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: 'Generated image',
      timestamp: Date.now(),
      metadata: {
        toolResultDetails: {
          assets: [
            {
              type: 'image',
              url: 'https://example.com/generated.png?signature=temporary',
              mimeType: 'image/png',
            },
          ],
        },
      },
    };
    const artifacts = parseToolResultMediaArtifacts(toolResultMsg, 'sess1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].content).toBe('https://example.com/generated.png?signature=temporary');
    expect(artifacts[0].filePath).toBeUndefined();
  });
});

describe('parseToolArtifact', () => {
  test('extracts file path from Write tool input', () => {
    const toolUseMsg = {
      id: 'tool1',
      type: 'tool_use' as const,
      content: '',
      timestamp: Date.now(),
      metadata: {
        toolName: 'Write',
        toolUseId: 'tu1',
        toolInput: { file_path: 'D:\\workspace\\hello.html', content: '<html></html>' },
      },
    };
    const toolResultMsg = {
      id: 'result1',
      type: 'tool_result' as const,
      content: 'OK',
      timestamp: Date.now(),
      metadata: { toolUseId: 'tu1' },
    };
    const artifact = parseToolArtifact(toolUseMsg, toolResultMsg, 'sess1');
    expect(artifact).not.toBeNull();
    expect(artifact!.filePath).toBe('D:\\workspace\\hello.html');
  });

  test('dedup: tool path and file link path normalize to same value', () => {
    const toolPath = 'D:\\new_ws_test_2\\hello-slide.pptx';
    const linkContent = '[hello-slide.pptx](file:///D:/new_ws_test_2/hello-slide.pptx)';
    const linkArtifacts = parseFileLinksFromMessage(linkContent, 'msg1', 'sess1');
    expect(linkArtifacts).toHaveLength(1);

    expect(normalizeFilePathForDedup(toolPath))
      .toBe(normalizeFilePathForDedup(linkArtifacts[0].filePath!));
  });
});
