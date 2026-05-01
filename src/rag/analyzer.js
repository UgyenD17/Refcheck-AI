import { retrieveRules } from "./ruleStore.js";

const VALID_VERDICTS = new Set(["Fair Call", "Bad Call", "Inconclusive"]);
const VALID_CONFIDENCE = new Set(["Low", "Medium", "High"]);
const VALID_REF_AI_DECISIONS = new Set(["Foul", "No Foul", "Inconclusive"]);

function summarizeRule(chunk) {
  return {
    id: chunk.id,
    law_number: chunk.law_number,
    law_title: chunk.law_title,
    section: chunk.section,
    text: chunk.text,
    source: chunk.source
  };
}

function normalizeModelResult(result, rules) {
  const verdict = VALID_VERDICTS.has(result?.verdict) ? result.verdict : "Inconclusive";
  const confidence = VALID_CONFIDENCE.has(result?.confidence) ? result.confidence : "Low";

  const reasoning =
    typeof result?.reasoning === "string" && result.reasoning.trim()
      ? result.reasoning.trim()
      : "The available retrieved rules do not support a more specific conclusion.";

  return {
    verdict,
    ref_ai_decision: VALID_REF_AI_DECISIONS.has(result?.ref_ai_decision)
      ? result.ref_ai_decision
      : inferRefAiDecision(verdict, result?.original_call),
    confidence,
    play_observation:
      typeof result?.play_observation === "string" && result.play_observation.trim()
        ? result.play_observation.trim()
        : "",
    reasoning,
    relevant_rules: rules.map(summarizeRule)
  };
}

function inferRefAiDecision(verdict, originalCall = "") {
  const originalWasFoul = /\bfoul|free kick|penalty|card|offside\b/i.test(originalCall);
  if (verdict === "Inconclusive") return "Inconclusive";
  if (verdict === "Fair Call") return originalWasFoul ? "Foul" : "No Foul";
  return originalWasFoul ? "No Foul" : "Foul";
}

function localRuleGroundedFallback({ original_call, play_description }, rules) {
  const description = `${original_call} ${play_description}`.toLowerCase();

  const directFreeKickRule = rules.find(
    (rule) => rule.law_number === "12" && rule.section.includes("Direct free kick")
  );

  const seriousFoulPlayRule = rules.find(
    (rule) => rule.law_number === "12" && rule.section.includes("Serious foul play")
  );

  const dogsoRule = rules.find(
    (rule) =>
      rule.law_number === "12" &&
      /Denying|Sending-off|Disciplinary/i.test(rule.section) &&
      /deliberate handball|denies the opposing team a goal|obvious goal-scoring/i.test(rule.text)
  );

  const offsideRule = rules.find(
    (rule) => rule.law_number === "11" && rule.section.includes("Offside offence")
  );

  const noOffsideRule = rules.find(
    (rule) => rule.law_number === "11" && rule.section.includes("No offence")
  );

  const hasTrip = /\btrip|trips|tripped|tripping\b/.test(description);
  const hasHandball = /\bhandball|hand|arm|handles|handled|handling\b/.test(description);

  const preventsGoal =
    /\bgoal|net|line|going in|go in|score|scoring|deny|denies|prevent|prevents|stop|stops\b/.test(
      description
    );

  const hasOpponent = /\battacker|opponent|player\b/.test(description);

  const originalWasFoul = /\bfoul|free kick|penalty\b/.test(
    String(original_call).toLowerCase()
  );

  const originalWasOffside = /\boffside\b/i.test(original_call);

  const dangerousChallenge =
    /\bbehind|lunge|excessive|reckless|dangerous\b/.test(description);

  const isOffside =
    /\boffside\b/.test(description) ||
    /\bahead of (the )?(second-last|second last|last) defender\b/.test(description) ||
    /\bbehind (the )?(second-last|second last|last) defender\b/.test(description);

  const involvedInPlay =
    /\breceives|received|plays|played|touches|touched|shoots|shot|scores|scored|interferes|challeng(es|ed)?\b/.test(
      description
    );

  const fromNoOffsideRestart =
    /\bgoal kick|throw-in|throw in|corner kick\b/.test(description);

  if (isOffside && involvedInPlay && !fromNoOffsideRestart && offsideRule) {
    return normalizeModelResult(
      {
        verdict: originalWasOffside ? "Fair Call" : "Bad Call",
        ref_ai_decision: "Foul",
        confidence: "Medium",
        play_observation: play_description,
        reasoning: `The retrieved ${offsideRule.section} chunk says a player in an offside position is penalised when they become involved in active play, including playing or touching a ball passed by a team-mate. The description says the attacker was ahead of the second-last defender when the pass was played and then received the ball, so an offside call is supported by Law 11.`
      },
      rules
    );
  }

  if (isOffside && involvedInPlay && fromNoOffsideRestart && noOffsideRule) {
    return normalizeModelResult(
      {
        verdict: originalWasOffside ? "Bad Call" : "Fair Call",
        ref_ai_decision: "No Foul",
        confidence: "Medium",
        play_observation: play_description,
        reasoning: `The retrieved ${noOffsideRule.section} chunk says there is no offside offence if a player receives the ball directly from a goal kick, throw-in, or corner kick. Because the description includes one of those restart situations, an offside call would not be supported.`
      },
      rules
    );
  }

  if (hasHandball && preventsGoal && directFreeKickRule) {
    const sanctionNote = dogsoRule
      ? ` If the handball denied a goal or obvious goal-scoring opportunity, ${dogsoRule.section} says a deliberate handball offence is a sending-off offence, while non-deliberate handball with a penalty can still require a caution.`
      : "";

    return normalizeModelResult(
      {
        verdict: originalWasFoul ? "Fair Call" : "Bad Call",
        ref_ai_decision: "Foul",
        confidence: "Medium",
        play_observation: play_description,
        reasoning: `The retrieved ${directFreeKickRule.section} chunk states that handball is a direct free kick offence and explains that a player is penalised when the hand/arm position makes the body unnaturally bigger or the player deliberately touches the ball with the hand/arm. A defender using an arm to stop a ball from entering the goal is therefore a handball offence if the contact occurred while the ball was in play.${sanctionNote}`
      },
      rules
    );
  }

  if (hasTrip && hasOpponent && originalWasFoul && directFreeKickRule) {
    const severityNote =
      dangerousChallenge && seriousFoulPlayRule
        ? ` The description may also require disciplinary review under ${seriousFoulPlayRule.section} if the challenge endangered the opponent.`
        : "";

    return normalizeModelResult(
      {
        verdict: "Fair Call",
        ref_ai_decision: "Foul",
        confidence: "Medium",
        play_observation: play_description,
        reasoning: `The retrieved ${directFreeKickRule.section} chunk lists tripping or attempting to trip an opponent as a direct free kick offence when committed carelessly, recklessly, or with excessive force. A referee call of foul is therefore supported by Law ${directFreeKickRule.law_number}.${severityNote}`
      },
      rules
    );
  }

  return normalizeModelResult(
    {
      verdict: "Inconclusive",
      ref_ai_decision: "Inconclusive",
      confidence: "Low",
      play_observation: play_description,
      reasoning:
        "The retrieved IFAB law chunks are relevant, but the play description does not include enough facts to decide whether the original call was correct."
    },
    rules
  );
}

function buildRuleContext(rules) {
  return rules
    .map(
      (rule, index) =>
        `[${index + 1}] ${rule.id}: ${rule.section} (${rule.source})\nLaw ${rule.law_number} - ${rule.law_title}\n${rule.text}`
    )
    .join("\n\n");
}

function responseSchema() {
  return {
    type: "json_schema",
    name: "refcheck_verdict",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "verdict",
        "ref_ai_decision",
        "confidence",
        "play_observation",
        "reasoning",
        "cited_rule_ids"
      ],
      properties: {
        verdict: { type: "string", enum: ["Fair Call", "Bad Call", "Inconclusive"] },
        ref_ai_decision: { type: "string", enum: ["Foul", "No Foul", "Inconclusive"] },
        confidence: { type: "string", enum: ["Low", "Medium", "High"] },
        play_observation: { type: "string" },
        reasoning: { type: "string" },
        cited_rule_ids: {
          type: "array",
          items: { type: "string" }
        }
      }
    }
  };
}

async function callOpenAI({ original_call, play_description, frame_data_urls = [] }, rules) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const ruleContext = buildRuleContext(rules);

  const content = [
    {
      type: "input_text",
      text: `Original call: ${original_call}\nPlay description or reviewer notes: ${
        play_description || "No manual description provided. Analyze only the sampled clip frames."
      }\n\nRetrieved rules:\n${ruleContext}`
    },
    ...frame_data_urls.slice(0, 8).map((image_url) => ({
      type: "input_image",
      image_url,
      detail: "low"
    }))
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are RefCheck AI. Inspect any sampled soccer clip frames, summarize the visible play, decide whether Ref AI would call Foul, No Foul, Offside, Card, or Inconclusive, and judge the original referee call only from the retrieved IFAB rule chunks. You can analyze offside, handball, fouls, yellow cards, red cards, penalties, free kicks, throw-ins, goal kicks, and corner kicks. If the frames do not show enough contact, timing, player position, restart context, or ball state, return Inconclusive. Return strict JSON with verdict, ref_ai_decision, confidence, play_observation, reasoning, and cited_rule_ids. Verdict must be Fair Call, Bad Call, or Inconclusive. ref_ai_decision must be Foul, No Foul, or Inconclusive. Confidence must be Low, Medium, or High. Cite chunk ids in the reasoning."
        },
        {
          role: "user",
          content
        }
      ],
      text: {
        format: responseSchema()
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`AI response failed with ${response.status}: ${detail}`);
    error.statusCode = 502;
    throw error;
  }

  const payload = await response.json();
  const text = payload.output_text;

  if (!text) {
    const error = new Error("AI response did not include output_text.");
    error.statusCode = 502;
    throw error;
  }

  return JSON.parse(text);
}

export async function analyzeCall(input) {
  const sport = String(input?.sport || "").toLowerCase();
  const original_call = String(input?.original_call || "").trim();
  const play_description = String(input?.play_description || "").trim();

  if (!sport || !original_call || !play_description) {
    const error = new Error("sport, original_call, and play_description are required.");
    error.statusCode = 400;
    throw error;
  }

  const rules = await retrieveRules({ sport, original_call, play_description }, 6);
  const usefulRules = rules.filter((rule) => rule.score > 0);

  if (!usefulRules.length) {
    return {
      verdict: "Inconclusive",
      ref_ai_decision: "Inconclusive",
      confidence: "Low",
      reasoning: "No relevant rule chunks were found for this description.",
      relevant_rules: rules.map(summarizeRule),
      ai_used: false
    };
  }

  try {
    const modelResult = await callOpenAI({ original_call, play_description }, usefulRules);

    if (modelResult) {
      return {
        ...normalizeModelResult(modelResult, usefulRules),
        ai_used: true
      };
    }
  } catch (error) {
    if (process.env.REFCHECK_STRICT_AI === "true") throw error;

    return {
      ...localRuleGroundedFallback({ original_call, play_description }, usefulRules),
      ai_used: false,
      warning: "AI response failed, so RefCheck used the local rule-grounded fallback."
    };
  }

  return {
    ...localRuleGroundedFallback({ original_call, play_description }, usefulRules),
    ai_used: false
  };
}

export async function analyzeClip(input) {
  const sport = String(input?.sport || "").toLowerCase();
  const original_call = String(input?.original_call || "").trim();
  const play_description = String(input?.play_description || "").trim();
  const frame_data_urls = Array.isArray(input?.frame_data_urls) ? input.frame_data_urls : [];
  const clip = input?.clip || {};

  if (!sport || !original_call) {
    const error = new Error("sport and original_call are required.");
    error.statusCode = 400;
    throw error;
  }

  if (!frame_data_urls.length && !play_description) {
    const error = new Error("Upload a playable clip or add reviewer notes before analyzing.");
    error.statusCode = 400;
    throw error;
  }

  const retrievalDescription =
    play_description ||
    "soccer referee decision foul no foul tackle challenge contact trip kick push reckless excessive force serious foul play handball offside penalty free kick throw-in goal kick corner kick ball in play ball out of play restart yellow card red card caution sending-off violent conduct dogso";

  const rules = await retrieveRules(
    {
      sport,
      original_call,
      play_description: retrievalDescription
    },
    10
  );

  const usefulRules = rules.filter((rule) => rule.score > 0);

  if (!usefulRules.length) {
    return {
      verdict: "Inconclusive",
      ref_ai_decision: "Inconclusive",
      confidence: "Low",
      play_observation: "No relevant IFAB rule chunks were found.",
      reasoning: "Rules are missing for this clip review.",
      relevant_rules: rules.map(summarizeRule),
      ai_used: false,
      clip
    };
  }

  try {
    const modelResult = await callOpenAI(
      { original_call, play_description, frame_data_urls },
      usefulRules
    );

    if (modelResult) {
      return {
        ...normalizeModelResult(modelResult, usefulRules),
        ai_used: true,
        clip
      };
    }
  } catch (error) {
    if (process.env.REFCHECK_STRICT_AI === "true") throw error;

    if (play_description) {
      return {
        ...localRuleGroundedFallback({ original_call, play_description }, usefulRules),
        ai_used: false,
        clip,
        warning: "AI video analysis failed, so RefCheck used the reviewer notes and retrieved rules."
      };
    }

    return {
      verdict: "Inconclusive",
      ref_ai_decision: "Inconclusive",
      confidence: "Low",
      play_observation:
        "The clip frames were uploaded, but AI video-frame analysis failed and no reviewer notes were provided.",
      reasoning:
        "RefCheck cannot decide foul or no foul from the uploaded clip without a working vision model response. The retrieved IFAB Laws chunks are attached for review.",
      relevant_rules: usefulRules.map(summarizeRule),
      ai_used: false,
      clip,
      warning: "AI video analysis failed."
    };
  }

  if (play_description) {
    return {
      ...localRuleGroundedFallback({ original_call, play_description }, usefulRules),
      ai_used: false,
      clip
    };
  }

  return {
    verdict: "Inconclusive",
    ref_ai_decision: "Inconclusive",
    confidence: "Low",
    play_observation:
      "Clip frames were captured, but OPENAI_API_KEY is not configured, so visual analysis is unavailable.",
    reasoning:
      "Set OPENAI_API_KEY to let RefCheck analyze sampled clip frames. Without video analysis or reviewer notes, it cannot make a rule-grounded decision.",
    relevant_rules: usefulRules.map(summarizeRule),
    ai_used: false,
    clip
  };
}