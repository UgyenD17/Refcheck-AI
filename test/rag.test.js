import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCall, analyzeClip } from "../src/rag/analyzer.js";
import { retrieveRules } from "../src/rag/ruleStore.js";

test("retrieves direct free kick rule for a trip", async () => {
  const rules = await retrieveRules({
    sport: "soccer",
    original_call: "Foul",
    play_description: "Defender trips the attacker from behind while challenging for the ball."
  });

  assert.equal(rules[0].law_number, "12");
  assert.match(rules[0].section, /Direct free kick|Serious foul play/);
});

test("analyzes sample foul without random verdicts", async () => {
  const result = await analyzeCall({
    sport: "soccer",
    original_call: "Foul",
    play_description: "Defender trips the attacker from behind while challenging for the ball."
  });

  assert.equal(result.verdict, "Fair Call");
  assert.equal(result.ref_ai_decision, "Foul");
  assert.equal(result.confidence, "Medium");
  assert.match(result.reasoning, /Law 12|12\.1|Direct free kick/i);
  assert.ok(result.relevant_rules.length > 0);
});

test("creates a clip analysis from reviewer notes without an API key", async () => {
  const result = await analyzeClip({
    sport: "soccer",
    original_call: "Foul",
    play_description: "Defender trips the attacker from behind while challenging for the ball.",
    clip: {
      name: "sample.mp4",
      type: "video/mp4",
      size: 1024
    },
    frame_data_urls: []
  });

  assert.equal(result.verdict, "Fair Call");
  assert.equal(result.ref_ai_decision, "Foul");
  assert.equal(result.clip.name, "sample.mp4");
  assert.ok(result.relevant_rules.some((rule) => rule.section === "12.1 Direct free kick"));
});

test("flags a defender handball that stops the ball entering the net", async () => {
  const result = await analyzeClip({
    sport: "soccer",
    original_call: "No call",
    play_description:
      "A defender on the goal line raises his arm and uses his hand to stop the ball from going into the net.",
    clip: {
      name: "videoplayback.mp4",
      type: "video/mp4",
      size: 1024
    },
    frame_data_urls: []
  });

  assert.equal(result.ref_ai_decision, "Foul");
  assert.equal(result.verdict, "Bad Call");
  assert.match(result.reasoning, /handball|hand\/arm|denied/i);
});
