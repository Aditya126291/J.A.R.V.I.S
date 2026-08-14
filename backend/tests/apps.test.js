const { CLOSE_MAP } = require('../modules/command_registry');
const { processNamesForTarget, resolveOpenTarget } = require('../modules/apps');

describe('app command safety and launch targeting', () => {
  test('website names never resolve to the Chrome process', () => {
    expect(CLOSE_MAP.youtube).toBeUndefined();
    expect(CLOSE_MAP.gmail).toBeUndefined();
    expect(processNamesForTarget('youtube')).toEqual([]);
  });

  test('real desktop apps retain a verifiable process target', () => {
    expect(processNamesForTarget('notepad')).toEqual(['notepad']);
    expect(processNamesForTarget('whatsapp')).toEqual(['WhatsApp']);
  });

  test('WhatsApp uses the dedicated desktop launch route', () => {
    expect(resolveOpenTarget('whatsapp')).toBe('whatsapp:');
  });
});
