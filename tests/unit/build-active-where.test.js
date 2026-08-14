const buildActiveWhere = require('../../server/lib/buildActiveWhere');

describe('buildActiveWhere', () => {
  const activeCondition = ['deleted_at', null];

  it('returns only the active condition when no filters are provided', () => {
    expect(buildActiveWhere('deleted_at')).toEqual([activeCondition]);
  });

  it('combines one filter with the active condition using AND for either operator', () => {
    const condition = ['id', 1];

    expect(buildActiveWhere('deleted_at', condition)).toEqual([activeCondition, condition]);
    expect(buildActiveWhere('deleted_at', condition, 'OR')).toEqual([activeCondition, 'AND', condition]);
  });

  it('groups multiple OR filters after the active condition', () => {
    const idCondition = ['id', 1];
    const emailCondition = ['email', 'user@example.com'];

    expect(buildActiveWhere('deleted_at', [idCondition, emailCondition], 'OR')).toEqual([activeCondition, 'AND', idCondition, 'OR', emailCondition]);
  });

  it('preserves AND between multiple filters', () => {
    const conditions = [
      ['name', 'User'],
      ['email', 'user@example.com'],
    ];

    expect(buildActiveWhere('deleted_at', conditions)).toEqual([activeCondition, ...conditions]);
  });
});
