import { Type } from '@sinclair/typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

type PluginConfig = {
  callbackUrl: string;
  secret: string;
  requestTimeoutMs: number;
};

type MediaToolRequest = {
  tool: string;
  args: Record<string, unknown>;
  context: {
    sessionKey: string;
    toolCallId: string;
  };
};

type MediaToolResponse = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  details?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 120_000;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const sanitizeArgsForLog = (args: Record<string, unknown>): Record<string, unknown> => {
  const prompt = typeof args.prompt === 'string' ? args.prompt : '';
  return {
    action: typeof args.action === 'string' ? args.action : 'generate',
    model: typeof args.model === 'string' ? args.model : '',
    promptLength: prompt.length,
    hasImage: typeof args.image === 'string',
    imageCount: Array.isArray(args.images) ? args.images.length : undefined,
    hasVideo: typeof args.video === 'string',
    videoCount: Array.isArray(args.videos) ? args.videos.length : undefined,
    aspectRatio: args.aspectRatio,
    resolution: args.resolution,
    size: args.size,
    count: args.count,
    durationSeconds: args.durationSeconds,
  };
};

const parsePluginConfig = (value: unknown): PluginConfig => {
  const raw = isRecord(value) ? value : {};
  return {
    callbackUrl: typeof raw.callbackUrl === 'string' ? raw.callbackUrl.trim() : '',
    secret: typeof raw.secret === 'string' ? raw.secret.trim() : '',
    requestTimeoutMs: typeof raw.requestTimeoutMs === 'number' ? raw.requestTimeoutMs : DEFAULT_TIMEOUT_MS,
  };
};

async function callMediaBridge(
  config: PluginConfig,
  request: MediaToolRequest,
): Promise<MediaToolResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(config.callbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lobster-media-secret': config.secret,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Media generation callback HTTP ${response.status}: ${text.trim() || response.statusText}`);
    }

    if (!text.trim()) {
      return { content: [{ type: 'text', text: 'No response from server.' }], isError: true };
    }

    const parsed = JSON.parse(text);
    if (isRecord(parsed) && Array.isArray(parsed.content)) {
      return parsed as MediaToolResponse;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
      details: isRecord(parsed) ? parsed as Record<string, unknown> : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { content: [{ type: 'text', text: 'Media generation request timed out.' }], isError: true };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const ImageGenerateSchema = Type.Object({
  action: Type.Optional(Type.Union([
    Type.Literal('generate'),
    Type.Literal('list'),
    Type.Literal('status'),
  ], { description: 'Action to perform. Default: generate.' })),
  prompt: Type.Optional(Type.String({ description: 'Text prompt describing the image to generate.' })),
  model: Type.Optional(Type.String({ description: 'Model ID for generation. Use action=list to see available models.' })),
  image: Type.Optional(Type.String({ description: 'Single reference image file path for image-to-image generation.' })),
  images: Type.Optional(Type.Array(Type.String(), { description: 'Multiple reference image file paths for multi-image generation.' })),
  size: Type.Optional(Type.String({ description: 'Output size, e.g. "1024x1024".' })),
  aspectRatio: Type.Optional(Type.String({ description: 'Aspect ratio, e.g. "1:1", "16:9", "9:16".' })),
  resolution: Type.Optional(Type.String({ description: 'Resolution: "1K", "2K", "4K".' })),
  count: Type.Optional(Type.Number({ description: 'Number of images to generate. Default: 1.', minimum: 1, maximum: 4 })),
  filename: Type.Optional(Type.String({ description: 'Suggested filename for the output.' })),
  taskId: Type.Optional(Type.String({ description: 'Task ID for status queries.' })),
  providerOptions: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Model-specific options passed through to the provider.' })),
});

const VideoGenerateSchema = Type.Object({
  action: Type.Optional(Type.Union([
    Type.Literal('generate'),
    Type.Literal('list'),
    Type.Literal('status'),
    Type.Literal('cancel'),
  ], { description: 'Action to perform. Default: generate.' })),
  prompt: Type.Optional(Type.String({ description: 'Text prompt describing the video to generate.' })),
  model: Type.Optional(Type.String({ description: 'Model ID for generation. Use action=list to see available models.' })),
  image: Type.Optional(Type.String({ description: 'Single reference image file path (e.g. first frame).' })),
  images: Type.Optional(Type.Array(Type.String(), { description: 'Multiple reference image file paths (first frame, character reference, etc.).' })),
  imageRoles: Type.Optional(Type.Array(Type.String(), { description: 'Role for each image: "first_frame", "last_frame", "reference_image".' })),
  video: Type.Optional(Type.String({ description: 'Single reference video file path.' })),
  videos: Type.Optional(Type.Array(Type.String(), { description: 'Multiple reference video file paths.' })),
  videoRoles: Type.Optional(Type.Array(Type.String(), { description: 'Role for each video: "reference_video".' })),
  aspectRatio: Type.Optional(Type.String({ description: 'Aspect ratio, e.g. "16:9", "9:16", "1:1".' })),
  resolution: Type.Optional(Type.String({ description: 'Resolution: "480P", "720P", "768P", "1080P".' })),
  durationSeconds: Type.Optional(Type.Number({ description: 'Video duration in seconds.', minimum: 1, maximum: 60 })),
  audio: Type.Optional(Type.Boolean({ description: 'Whether to include audio. Default: true.' })),
  watermark: Type.Optional(Type.Boolean({ description: 'Whether to include watermark. Default: false.' })),
  filename: Type.Optional(Type.String({ description: 'Suggested filename for the output.' })),
  taskId: Type.Optional(Type.String({ description: 'Task ID for status/cancel queries.' })),
  providerOptions: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Model-specific options passed through to the provider.' })),
});

const plugin = {
  id: 'lobster-media-generation',
  name: 'LobsterMediaGeneration',
  description: 'Image and video generation tools powered by LobsterAI server.',
  configSchema: {
    parse(value: unknown): PluginConfig {
      return parsePluginConfig(value);
    },
  },
  register(api: OpenClawPluginApi) {
    const config = parsePluginConfig(api.pluginConfig);
    if (!config.callbackUrl || !config.secret) {
      api.logger.info('[lobster-media-generation] skipped: callbackUrl or secret not configured.');
      return;
    }

    api.registerTool((ctx) => {
      const sessionKey = ctx.sessionKey ?? '';
      if (!sessionKey.startsWith('agent:main:lobsterai:')) {
        return null;
      }

      return {
        name: 'lobsterai_image_generate',
        label: 'Image Generation',
        description: [
          'Generate images using LobsterAI server.',
          'Supports text-to-image and image-to-image generation.',
          'Use action="list" to see available models and their capabilities.',
          'Use action="status" with taskId to check async task progress.',
          'Requires an active subscription with available image generation quota.',
        ].join(' '),
        parameters: ImageGenerateSchema,
        async execute(id: string, params: unknown) {
          const args = (params ?? {}) as Record<string, unknown>;
          try {
            api.logger.info(`[lobster-media-generation] image tool callback started: toolCallId=${id} args=${JSON.stringify(sanitizeArgsForLog(args))}`);
            const startedAt = Date.now();
            const result = await callMediaBridge(config, {
              tool: 'lobsterai_image_generate',
              args,
              context: { sessionKey, toolCallId: id },
            });
            api.logger.info(`[lobster-media-generation] image tool callback completed: toolCallId=${id} elapsedMs=${Date.now() - startedAt} isError=${result.isError === true}`);
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            api.logger.info(`[lobster-media-generation] image tool callback failed: toolCallId=${id} error=${message}`);
            return { content: [{ type: 'text', text: `Image generation failed: ${message}` }], isError: true };
          }
        },
      };
    });

    api.registerTool((ctx) => {
      const sessionKey = ctx.sessionKey ?? '';
      if (!sessionKey.startsWith('agent:main:lobsterai:')) {
        return null;
      }

      return {
        name: 'lobster_video_generate',
        label: 'Video Generation',
        description: [
          'Generate videos using LobsterAI server.',
          'Supports text-to-video, image-to-video, and video editing.',
          'Use action="list" to see available models and their capabilities.',
          'Use action="status" with taskId to check async task progress.',
          'Use action="cancel" with taskId to cancel a running task.',
          'Video generation is asynchronous - submit a task then poll status until completion.',
          'Requires an active subscription with available video generation quota.',
        ].join(' '),
        parameters: VideoGenerateSchema,
        async execute(id: string, params: unknown) {
          const args = (params ?? {}) as Record<string, unknown>;
          try {
            api.logger.info(`[lobster-media-generation] video tool callback started: toolCallId=${id} args=${JSON.stringify(sanitizeArgsForLog(args))}`);
            const startedAt = Date.now();
            const result = await callMediaBridge(config, {
              tool: 'lobster_video_generate',
              args,
              context: { sessionKey, toolCallId: id },
            });
            api.logger.info(`[lobster-media-generation] video tool callback completed: toolCallId=${id} elapsedMs=${Date.now() - startedAt} isError=${result.isError === true}`);
            return result;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            api.logger.info(`[lobster-media-generation] video tool callback failed: toolCallId=${id} error=${message}`);
            return { content: [{ type: 'text', text: `Video generation failed: ${message}` }], isError: true };
          }
        },
      };
    });

    api.logger.info('[lobster-media-generation] registered lobsterai_image_generate and lobster_video_generate tools.');
  },
};

export default plugin;
