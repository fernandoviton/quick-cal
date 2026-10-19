const { upsertEnvLine } = require('../../scripts/env-file');

describe('upsertEnvLine', () => {
    test('appends to empty contents with trailing newline', () => {
        expect(upsertEnvLine('', 'KEY', 'value')).toBe('KEY=value\n');
    });

    test('replaces an existing key in place', () => {
        const before = 'A=1\nKEY=old\nB=2\n';
        expect(upsertEnvLine(before, 'KEY', 'new')).toBe('A=1\nKEY=new\nB=2\n');
    });

    test('appends a missing key, preserving existing lines', () => {
        expect(upsertEnvLine('A=1\n', 'KEY', 'v')).toBe('A=1\nKEY=v\n');
    });

    test('adds a newline before appending when contents lack one', () => {
        expect(upsertEnvLine('A=1', 'KEY', 'v')).toBe('A=1\nKEY=v\n');
    });

    test('replaces an empty-valued key', () => {
        expect(upsertEnvLine('KEY=\n', 'KEY', 'v')).toBe('KEY=v\n');
    });

    test('does not touch keys that merely share a prefix', () => {
        const before = 'KEY_LONGER=x\n';
        expect(upsertEnvLine(before, 'KEY', 'v')).toBe('KEY_LONGER=x\nKEY=v\n');
    });
});
