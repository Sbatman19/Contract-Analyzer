const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-5";

async function runAgent(systemPrompt, userContent) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: "user", content: userContent }],
    system: systemPrompt,
  });
  return response.content[0].text;
}

// AGENT 1 — CONTRACT INTAKE AGENT
async function intakeAgent(contractText) {
  const system = `You are the Contract Intake Agent for Contract Risk Analyzer. You are the first step in a 4-agent contract analysis pipeline.

Your job is to read the full contract provided and return a structured JSON intake summary.

You MUST respond with ONLY a valid JSON object in this exact format, no other text:
{
  "contractType": "string - the type of contract",
  "partyA": "string - first party name",
  "partyB": "string - second party name", 
  "effectiveDate": "string - effective date or Not specified",
  "duration": "string - contract duration or Not specified",
  "primaryPurpose": "string - one sentence description",
  "immediateRedFlags": ["array of strings, each a brief red flag, or empty array if none"],
  "contractLength": "string - approximate length description"
}

Identify contract types accurately: freelance service agreement, client retainer, vendor contract, SaaS subscription, employment agreement, contractor agreement, NDA, partnership agreement, or other.`;

  const result = await runAgent(system, `Analyze this contract:\n\n${contractText}`);
  
  try {
    const cleaned = result.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return {
      contractType: "Contract",
      partyA: "Party A",
      partyB: "Party B",
      effectiveDate: "Not specified",
      duration: "Not specified",
      primaryPurpose: "Contract analysis in progress",
      immediateRedFlags: [],
      contractLength: "Standard length"
    };
  }
}

// AGENT 2 — CLAUSE EXTRACTION AGENT
async function clauseExtractionAgent(contractText, intakeSummary) {
  const system = `You are the Clause Extraction Agent for Contract Risk Analyzer. You receive a full contract and extract every significant clause into 10 categorized buckets.

You MUST respond with ONLY a valid JSON object in this exact format, no other text:
{
  "paymentTerms": { "status": "PRESENT|ABSENT|VAGUE", "content": "string describing the clause content" },
  "liabilityLimitations": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" },
  "intellectualProperty": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" },
  "termination": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" },
  "confidentiality": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" },
  "indemnification": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" },
  "disputeResolution": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" },
  "nonCompete": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" },
  "autoRenewal": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" },
  "otherSignificantClauses": { "status": "PRESENT|ABSENT|VAGUE", "content": "string" }
}

For ABSENT clauses, the content should explain the implication of the absence for this contract type.
Be thorough — the Risk Scoring Agent depends on your completeness.`;

  const userContent = `Contract Type: ${intakeSummary.contractType}
Parties: ${intakeSummary.partyA} and ${intakeSummary.partyB}

Full Contract:
${contractText}`;

  const result = await runAgent(system, userContent);
  
  try {
    const cleaned = result.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return {};
  }
}

// AGENT 3 — RISK SCORING AGENT
async function riskScoringAgent(clauses, intakeSummary) {
  const system = `You are the Risk Scoring Agent for Contract Risk Analyzer. You score every clause using a 4-level risk rating system.

RATING DEFINITIONS:
- GREEN: Standard and reasonable. No action needed.
- YELLOW: Review recommended. Unusual, one-sided, or vague. Negotiate before signing.
- RED: Serious risk. Significantly favors other party or exposes user to major liability.
- BLACK: Walk away trigger. Egregious and dangerous without major revision.

For ABSENT critical clauses, score based on what the absence means for this contract type.

You MUST respond with ONLY a valid JSON object in this exact format, no other text:
{
  "scores": {
    "paymentTerms": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "liabilityLimitations": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "intellectualProperty": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "termination": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "confidentiality": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "indemnification": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "disputeResolution": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "nonCompete": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "autoRenewal": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" },
    "otherSignificantClauses": { "rating": "GREEN|YELLOW|RED|BLACK", "rationale": "string", "action": "string or null" }
  },
  "overallRiskLevel": "LOW|MODERATE|HIGH|CRITICAL",
  "overallSummary": "string - 2 sentence plain English summary of overall risk"
}`;

  const userContent = `Contract Type: ${intakeSummary.contractType}
Immediate Red Flags from Intake: ${intakeSummary.immediateRedFlags.join(", ") || "None"}

Extracted Clauses:
${JSON.stringify(clauses, null, 2)}`;

  const result = await runAgent(system, userContent);
  
  try {
    const cleaned = result.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return { scores: {}, overallRiskLevel: "MODERATE", overallSummary: "Analysis complete." };
  }
}

// AGENT 4 — PLAIN ENGLISH BRIEF WRITER
async function briefWriterAgent(intakeSummary, clauses, scoringReport) {
  const system = `You are the Plain English Brief Writer for Contract Risk Analyzer. You write the final contract risk report in clear, jargon-free language that any business owner can immediately understand and act on.

Your tone is like a brilliant, plain-speaking friend who understands contracts — not a lawyer, not a robot. Confident, direct, and genuinely helpful.

You MUST respond with ONLY a valid JSON object in this exact format, no other text:
{
  "criticalFlags": ["array of strings - plain English description of RED and BLACK items, empty if none"],
  "overallRiskLevel": "LOW|MODERATE|HIGH|CRITICAL",
  "overallSummary": "string - 2 sentences what this risk level means for the user in plain English",
  "clauseBreakdown": [
    {
      "category": "string - readable category name",
      "rating": "GREEN|YELLOW|RED|BLACK",
      "plainEnglishExplanation": "string - what this clause actually means in practice",
      "action": "string - specific plain English action to take, or null if GREEN"
    }
  ],
  "missingClauses": ["array of strings - plain English explanation of missing clauses that matter"],
  "preSigningChecklist": ["array of strings - specific questions and changes to request, ordered by priority"],
  "bottomLine": "string - 3 sentences max. Is this reasonable? Most important fix? Attorney needed?"
}`;

  const userContent = `Contract Type: ${intakeSummary.contractType}
Parties: ${intakeSummary.partyA} and ${intakeSummary.partyB}
Effective Date: ${intakeSummary.effectiveDate}
Overall Risk Level: ${scoringReport.overallRiskLevel}

Intake Flags: ${intakeSummary.immediateRedFlags.join(", ") || "None"}

Clause Scores:
${JSON.stringify(scoringReport.scores, null, 2)}

Clause Details:
${JSON.stringify(clauses, null, 2)}`;

  const result = await runAgent(system, userContent);
  
  try {
    const cleaned = result.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return {
      criticalFlags: [],
      overallRiskLevel: scoringReport.overallRiskLevel || "MODERATE",
      overallSummary: scoringReport.overallSummary || "Analysis complete.",
      clauseBreakdown: [],
      missingClauses: [],
      preSigningChecklist: [],
      bottomLine: "Analysis complete. Review the clause breakdown above for details."
    };
  }
}

// MAIN PIPELINE — runs all 4 agents in sequence
async function runContractAnalysis(contractText, onProgress) {
  onProgress("intake", "Identifying contract type and parties...");
  const intake = await intakeAgent(contractText);

  onProgress("extraction", "Extracting and categorizing all clauses...");
  const clauses = await clauseExtractionAgent(contractText, intake);

  onProgress("scoring", "Scoring every clause for risk...");
  const scoring = await riskScoringAgent(clauses, intake);

  onProgress("brief", "Writing your plain-English risk report...");
  const brief = await briefWriterAgent(intake, clauses, scoring);

  return { intake, clauses, scoring, brief };
}

module.exports = { runContractAnalysis };
