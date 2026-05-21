import { expect, test } from 'vitest';

import {
  MediaGenerationGateReason,
  MediaGenerationTool,
  MediaSelectionMode,
  resolveMediaGenerationGate,
} from './mediaGenerationPolicy';

test('media generation gate blocks generate without selection or explicit model', () => {
  expect(resolveMediaGenerationGate({
    action: 'generate',
    tool: MediaGenerationTool.Image,
  })).toEqual({
    allowed: false,
    reason: MediaGenerationGateReason.MediaNotEnabled,
    message: 'Media generation is not enabled for this turn. The user has not selected a media model.',
  });
});

test('media generation gate allows explicit model without UI selection', () => {
  expect(resolveMediaGenerationGate({
    action: 'generate',
    tool: MediaGenerationTool.Image,
    explicitModel: 'doubao-seedream-5-0-260128',
  })).toEqual({ allowed: true });
});

test('media generation gate blocks wrong media type from selected turn model', () => {
  expect(resolveMediaGenerationGate({
    action: 'generate',
    tool: MediaGenerationTool.Image,
    selection: { mode: MediaSelectionMode.Video, modelId: 'doubao-seedance-2-0-260128' },
  })).toEqual({
    allowed: false,
    reason: MediaGenerationGateReason.WrongMediaType,
    message: 'Image generation is not available. The user selected a video generation model for this turn.',
  });
});
