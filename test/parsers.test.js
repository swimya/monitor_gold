import assert from 'node:assert/strict';
import test from 'node:test';

import { extractItemIdFromUrl, weightFromName } from '../src/parsers/chinagoldcoin.js';

test('weightFromName：从名称里认出单件克重', () => {
  assert.equal(weightFromName('招福传家·瑞蛇金条10克'), 10);
  assert.equal(weightFromName('1克封装金币'), 1);
  assert.equal(weightFromName('熊猫金币 15克封装金币'), 15);
  assert.equal(weightFromName('金条 50.5克'), 50.5);
  assert.equal(weightFromName('银条 100g'), 100);
});

test('weightFromName：带件数时按总重计算', () => {
  // 1 克 × 3 枚 = 3 克
  assert.equal(weightFromName('中国金币迷你金1克（金币云商）3枚装'), 3);
  assert.equal(weightFromName('金条 10克 × 2枚装'), 20);
  // 只有 1 枚时不额外相乘
  assert.equal(weightFromName('金条 10克 1枚装'), 10);
});

test('weightFromName：推不出来时返回 null 而不是瞎猜', () => {
  assert.equal(weightFromName('3枚装'), null);
  assert.equal(weightFromName('熊猫金币封装金币'), null);
  assert.equal(weightFromName(''), null);
  assert.equal(weightFromName(null), null);
  assert.equal(weightFromName(undefined), null);
});

test('weightFromName：不会把英文单词里的 g 当成克', () => {
  // "Packaging" 里的 g 不能被误识别
  assert.equal(weightFromName('Gold Coin Packaging'), null);
  assert.equal(weightFromName('10g Gold Bar'), 10);
});

test('extractItemIdFromUrl：从商品网址取 itemId', () => {
  assert.equal(
    extractItemIdFromUrl('https://www.chinagoldcoin.net/products/110400105097008'),
    '110400105097008',
  );
  assert.equal(
    extractItemIdFromUrl('https://www.chinagoldcoin.net/products/110400105084005?itemId=1'),
    '110400105084005',
  );
  assert.equal(extractItemIdFromUrl('https://www.chinagoldcoin.net/'), null);
});
