/**
 * Pac-Baby: 프로필/점수 검증 순수 함수 테스트
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  avatarEmoji,
  countryToFlag,
  isPlausibleScore,
  isValidAvatarId,
  minRunDurationMs,
  normalizeCountryHint,
  normalizeNickname,
  scoreCapForRound,
  validateNickname,
} from '../src/validation.js';
import { AVATAR_EMOJIS, NICKNAME_RULE, SCORE_RULES } from '../src/constants.js';

test('닉네임은 앞뒤 공백 제거 + NFC 정규화 후 검증한다', () => {
  assert.equal(normalizeNickname('  팩베이비  '), '팩베이비');
  const result = validateNickname('  팩베이비  ');
  assert.equal(result.ok, true);
  assert.equal(result.value, '팩베이비');
  assert.equal(result.reason, 'OK');
});

test('닉네임 길이/문자 규칙을 지킨다', () => {
  assert.equal(validateNickname('').reason, 'EMPTY');
  assert.equal(validateNickname('a').reason, 'TOO_SHORT');
  assert.equal(validateNickname('a'.repeat(NICKNAME_RULE.maxLength + 1)).reason, 'TOO_LONG');
  assert.equal(validateNickname('hello world').reason, 'INVALID_FORMAT');
  assert.equal(validateNickname('baby!').reason, 'INVALID_FORMAT');
  assert.equal(validateNickname('아기_123').ok, true);
  assert.equal(validateNickname('Baby_01').ok, true);
});

test('이모지 id 는 1~12 만 허용한다', () => {
  assert.equal(AVATAR_EMOJIS.length, 12);
  assert.equal(isValidAvatarId(1), true);
  assert.equal(isValidAvatarId(12), true);
  assert.equal(isValidAvatarId(0), false);
  assert.equal(isValidAvatarId(13), false);
  assert.equal(isValidAvatarId('3'), true);
  assert.equal(isValidAvatarId(1.5), false);
  assert.equal(avatarEmoji(1), '🍼');
  assert.equal(avatarEmoji(12), '🥛');
  assert.equal(avatarEmoji(999), AVATAR_EMOJIS[0]);
});

test('라운드별 점수 상한/최소 시간이 서버 규칙과 일치한다', () => {
  assert.equal(scoreCapForRound(1), SCORE_RULES.scoreBase + SCORE_RULES.scorePerRound);
  assert.equal(scoreCapForRound(2), SCORE_RULES.scoreBase + 2 * SCORE_RULES.scorePerRound);
  assert.equal(scoreCapForRound(0), scoreCapForRound(1));
  assert.equal(scoreCapForRound(999), scoreCapForRound(99));

  assert.equal(
    minRunDurationMs(1),
    (SCORE_RULES.minBaseSeconds + SCORE_RULES.minSecondsPerRound) * 1000,
  );
  assert.equal(minRunDurationMs(2), minRunDurationMs(1) + SCORE_RULES.minSecondsPerRound * 1000);
});

test('점수 사전 검증은 상한/시간/라운드를 확인한다', () => {
  assert.equal(isPlausibleScore({ score: 1000, round: 1, durationMs: 60000 }).ok, true);
  assert.equal(
    isPlausibleScore({ score: scoreCapForRound(1) + 1, round: 1 }).reason,
    'SCORE_EXCEEDS_CAP',
  );
  assert.equal(isPlausibleScore({ score: -1, round: 1 }).ok, true);
  assert.equal(
    isPlausibleScore({ score: -100001, round: 1 }).reason,
    'SCORE_OUT_OF_RANGE',
  );
  assert.equal(
    isPlausibleScore({ score: 100, round: 0 }).reason,
    'ROUND_OUT_OF_RANGE',
  );
  assert.equal(isPlausibleScore({ score: 100, round: 1, durationMs: 1000 }).reason, 'TOO_FAST');
});

test('국가 힌트/국기 변환은 안전하게 동작한다', () => {
  assert.equal(normalizeCountryHint('ko-kr'), 'KR');
  assert.equal(normalizeCountryHint('KR'), 'KR');
  assert.equal(normalizeCountryHint('korea'), null);
  assert.equal(normalizeCountryHint(null), null);
  assert.equal(countryToFlag('KR'), '🇰🇷');
  assert.equal(countryToFlag(''), '');
});
