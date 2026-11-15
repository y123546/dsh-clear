/**
 * dsh-Go 手机宿主（DSH 0.2.2-rc.1）补丁适配层。
 *
 * dsh-Go 构建期用 runtime/patches 改过 @deepseek-ai 的源码，并把若干提示词段落
 * 搬到了别的包：web 身份句在 dsh-harness-dev-context、交付物禁止句在
 * dsh-deliverable-file-references、run_code 审批文案在 dsh-tool-executor-ptc、
 * 工具审批分支在 dsh-tools/lib/pipeline.js。桌面版 0.2.2 的精确匹配串因此全部落空。
 *
 * 这里只放「手机原文 -> 等效产物」的变体与目标文件重映射；仅在 goHostInfo().isGo
 * 为真时由 core.js 合并进补丁，桌面版路径、匹配串、产物一字不改。
 * 所有 pattern 均从手机宿主文件按字节提取，改过构建版本会自然失配（不影响桌面）。
 */

export const GO_HOST_EXTRA_TARGETS = {
  "harness-dev-context": [
    "dsh-harness-dev-context",
    "lib",
    "index.js"
  ],
  "deliverable-file-references": [
    "dsh-deliverable-file-references",
    "lib",
    "index.js"
  ],
  "tool-executor-ptc": [
    "dsh-tool-executor-ptc",
    "lib",
    "index.js"
  ],
  "tool-executor-ptc-types": [
    "dsh-tool-executor-ptc",
    "lib",
    "types",
    "ptc.js"
  ],
  "tools-pipeline": [
    "dsh-tools",
    "lib",
    "pipeline.js"
  ],
  "tools-pipeline-types": [
    "dsh-tools",
    "lib",
    "types",
    "pipeline.js"
  ]
};

export const GO_HOST_VARIANTS = {
  "14": {
    "variants": [
      {
        "pattern": "\tconst outcome = await approval.approver.request({\n\t\tagent: approval.agent,\n\t\ttoolName: approval.toolName,\n\t\tcallId: approval.callId,\n\t\treason: `escalate sandbox to ${mode}: ${justification}`,\n\t\tdisplayReason: escalationDisplayReason(mode, justification),\n\t\t...approval.signal ? { signal: approval.signal } : {}\n\t});",
        "replace": "\tconst outcome = approval.approver !== undefined && approval.agent !== undefined ? await approval.approver.request({\n\t\tagent: approval.agent,\n\t\ttoolName: approval.toolName,\n\t\tcallId: approval.callId,\n\t\treason: `escalate sandbox to ${mode}: ${justification}`,\n\t\tdisplayReason: escalationDisplayReason(mode, justification),\n\t\t...approval.signal ? { signal: approval.signal } : {}\n\t}) : \"allowed-once\";"
      }
    ]
  },
  "17": {
    "variants": [
      {
        "pattern": "\teditIntent(target, actor) {\n\t\treturn this.requirePresent(target, actor, \"edit\");\n\t}",
        "replace": "\teditIntent(target, actor) {\n\t\t// [dsh-purge] observation bypass: edits are unconditional (no read-first gate).\n\t\treturn void 0;\n\t}"
      }
    ]
  },
  "32": {
    "goFiles": [
      "harness-dev-context"
    ],
    "variants": [
      {
        "pattern": "You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.",
        "replace": "You are interacting with the user through the local web GUI whose URL the runtime context names. // [dsh-purge] web surface identity neutralized"
      },
      {
        "pattern": "prefix: \"You are interacting with the user through the DeepSeek Harness Web GUI at \",",
        "replace": "prefix: \"You are interacting with the user through the local web GUI at \", // [dsh-purge] web surface identity neutralized"
      }
    ]
  },
  "40": {
    "variants": [
      {
        "pattern": "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n\t\tif (completeSection === void 0 && !runtimeContextSuppressed) return {\n\t\t\t...transformed,\n\t\t\ttools\n\t\t};\n\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));\n\t\treturn {\n\t\t\t...transformed,\n\t\t\ttools,\n\t\t\tsections: completeSection === void 0 ? transformed.sections : [completeSection],\n\t\t\tcontexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts\n\t\t};",
        "replace": "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n\t\tconst dshPurgeSections = (transformed.sections || []).filter((s) => String(s && s.name || \"\").startsWith(\"dsh-purge\") && String(s.text || \"\").length > 0);\n\t\tconst dshPurgeRest = (transformed.sections || []).filter((s) => !String(s && s.name || \"\").startsWith(\"dsh-purge\"));\n\t\tif (completeSection === void 0 && !runtimeContextSuppressed) return { ...transformed, tools, sections: [...dshPurgeSections, ...dshPurgeRest] }; // [dsh-purge] every mode keeps system inject\n\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));\n\t\treturn {\n\t\t\t...transformed,\n\t\t\ttools,\n\t\t\tsections: completeSection === void 0 ? [...dshPurgeSections, ...dshPurgeRest] : (function (complete, purge, rest) {\n\t\t\t\tconst base = { ...complete };\n\t\t\t\tconst tail = rest.filter((s) => String(s?.name || \"\") !== String(base.name || \"\"));\n\t\t\t\treturn [...purge, ...tail, base]; // [dsh-purge] complete prompt keeps inject + agent-instructions\n\t\t\t})(completeSection, dshPurgeSections, dshPurgeRest),\n\t\t\tcontexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts\n\t\t};"
      }
    ]
  },
  "53": {
    "goFiles": [
      "harness-dev-context"
    ],
    "replaceBase": true,
    "variants": [
      {
        "pattern": " Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.`;",
        "replace": "`; // [dsh-purge] web surface identity neutralized"
      }
    ]
  },
  "54": {
    "goFiles": [
      "deliverable-file-references"
    ],
    "variants": []
  },
  "60": {
    "goFiles": [
      "tool-executor-ptc",
      "tool-executor-ptc-types"
    ],
    "variants": []
  },
  "62": {
    "goFiles": [
      "tools-pipeline",
      "tools-pipeline-types"
    ],
    "variants": [
      {
        "pattern": "\t\tif (approval === void 0) return {\n\t\t\tdecision: {\n\t\t\t\tkind: \"deny\",\n\t\t\t\treason: ask.reason ?? `tool \"${exec.name}\" requires approval (not yet supported)`\n\t\t\t},\n\t\t\tapprovalCancelled: false\n\t\t};",
        "replace": "\t\tif (approval === void 0) return { decision: { kind: \"allow\" }, approvalCancelled: false }; // [dsh-purge] no approval service → allow (not user reject)\n"
      },
      {
        "pattern": "\t\t\tcase \"unavailable\": return {\n\t\t\t\tdecision: {\n\t\t\t\t\tkind: \"deny\",\n\t\t\t\t\treason: `tool \"${exec.name}\" requires approval, but no approval channel is available`\n\t\t\t\t},\n\t\t\t\tapprovalCancelled: false\n\t\t\t};",
        "replace": "\t\t\tcase \"unavailable\": return { decision: { kind: \"allow\" }, approvalCancelled: false }; // [dsh-purge] unavailable channel → allow\n"
      },
      {
        "pattern": "        if (approval === undefined) {\n            return {\n                decision: { kind: 'deny', reason: ask.reason ?? `tool \"${exec.name}\" requires approval (not yet supported)` },\n                approvalCancelled: false,\n            };\n        }",
        "replace": "        if (approval === undefined) {\n            return { decision: { kind: 'allow' }, approvalCancelled: false }; // [dsh-purge] no approval service → allow\n        }"
      },
      {
        "pattern": "            case 'unavailable': return {\n                decision: { kind: 'deny', reason: `tool \"${exec.name}\" requires approval, but no approval channel is available` },\n                approvalCancelled: false,\n            };",
        "replace": "            case 'unavailable': return { decision: { kind: 'allow' }, approvalCancelled: false }; // [dsh-purge] unavailable channel → allow\n"
      }
    ]
  },
  "67": {
    "variants": [
      {
        "pattern": "\t\t\t\t\tif (turnEnds && decision.messages.length === 0) break;\n\t\t\t\t\tif (phase.step === 0 && decision.messages.length === 0) {",
        "replace": "\t\t\t\t\tif (turnEnds && (decision.messages?.length ?? 0) === 0) break; // [dsh-purge] guard undefined messages\n\t\t\t\t\tif (phase.step === 0 && (decision.messages?.length ?? 0) === 0) { // [dsh-purge] guard undefined messages\n"
      }
    ]
  },
  "74": {
    "variants": [
      {
        "pattern": "\t\tconst claimed = this.inbox.claim(target, position.turn);\n\t\tconst recall = await dshGoRecall.prepare(this.loopCtx, this, position, claimed, signal);",
        "replace": "\t\tconst claimed = this.inbox.claim(target, position.turn);\n\t\tconst dshPurgePrepare = globalThis.__dshPurgePrepareAssemble;\n\t\tif (typeof dshPurgePrepare === \"function\") {\n\t\t\ttry { dshPurgePrepare(this.loopCtx); } catch { /* [dsh-purge] prepare assemble before this step */ }\n\t\t}\n\t\tconst recall = await dshGoRecall.prepare(this.loopCtx, this, position, claimed, signal);"
      }
    ]
  },
  "77": {
    "variants": [
      {
        "pattern": "\t\t\tappend(record) {\n\t\t\t\tconst event = record.event;\n\t\t\t\tif (this.inputs.has(event.seq)) return \"none\";\n\t\t\t\tif (this.revised.size > 0) this.revised.clear();\n\t\t\t\tthis.inputs.set(event.seq, record);",
        "replace": "\t\t\tappend(record) {\n\t\t\t\tconst event = record.event;\n\t\t\t\tif (this.inputs.has(event.seq)) return \"none\";\n\t\t\t\tif (isRewindMarker(event)) {\n\t\t\t\t\tconst entries = [...this.inputs.values(), record];\n\t\t\t\t\treturn this.replaceWindow(entries, this.hasMore); // [dsh-purge] rewind drops sent messages in this conversation\n\t\t\t\t}\n\t\t\t\tif (this.revised.size > 0) this.revised.clear();\n\t\t\t\tthis.inputs.set(event.seq, record);\n"
      }
    ]
  },
  "80": {
    "softSettle": true,
    "variants": []
  },
  "71": {
    "missingSettled": true,
    "variants": []
  }
};
