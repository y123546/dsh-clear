/**
 * 注入文本的清洗。
 *
 * 上游默认提示词带 `<|im_start|>system:` 前缀（ChatML 角色标记）。
 * 这个标记进了 system 消息正文，多数接口直接报错 —— 手机引擎实测 0.1 秒「本轮出错」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { stripControlTokens } from "../lib/rules.js";

test("去掉 ChatML 标记与紧随其后的 role", () => {
  assert.equal(stripControlTokens("<|im_start|>system: hello"), "hello");
  assert.equal(stripControlTokens("<|im_start|>user\n你好<|im_end|>"), "user\n你好");
});

test("去掉其他常见控制符", () => {
  assert.equal(stripControlTokens("a<|endoftext|>b<|eot_id|>c"), "abc");
  assert.equal(stripControlTokens("<|begin_of_text|>x"), "x");
});

test("普通文本原样保留（含尖括号但不是控制符）", () => {
  const src = "用 <project_instructions> 包住，ok?";
  assert.equal(stripControlTokens(src), src);
  assert.equal(stripControlTokens(""), "");
  assert.equal(stripControlTokens(undefined), "");
});
