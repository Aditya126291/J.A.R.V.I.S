const { CLOSE_MAP } = require('../modules/command_registry');
const { normalizeLookupName, processNamesForTarget, resolveOpenTarget } = require('../modules/apps');

describe('app command safety and launch targeting', () => {
  test('website names never resolve to the Chrome process', () => {
    expect(CLOSE_MAP.youtube).toBeUndefined();
    expect(CLOSE_MAP.gmail).toBeUndefined();
    expect(processNamesForTarget('youtube')).toEqual([]);
  });

  test('real desktop apps retain a verifiable process target', () => {
    expect(processNamesForTarget('notepad')).toEqual(['notepad']);
    expect(processNamesForTarget('whatsapp')).toEqual(expect.arrayContaining(['WhatsApp', 'WhatsApp.Root']));
  });

  test('WhatsApp uses the dedicated desktop launch route', () => {
    expect(resolveOpenTarget('whatsapp')).toBe('whatsapp:');
  });

  test('only known aliases, URLs, and real paths bypass the Windows resolver', () => {
    expect(resolveOpenTarget('youtube')).toBe('https://youtube.com');
    expect(resolveOpenTarget('some folder that does not exist')).toBeNull();
  });

  test('normalizes file and shortcut names for exact matching', () => {
    expect(normalizeLookupName(' J.A.R.V.I.S.lnk ')).toBe('j.a.r.v.i.s');
    expect(normalizeLookupName('My   Project.exe')).toBe('my project');
  });
});
