import { useState, useRef } from 'react';

type Verdict = 'Fair Call' | 'Bad Call' | 'Inconclusive';
type DemoClip = 'handball' | 'offside' | 'foul' | '';
type Screen = 'login' | 'dashboard' | 'analysis' | 'history';

interface AnalysisResult {
  verdict: Verdict;
  confidence: string;
  decision: string;
  mode: string;
  observedPlay: string;
  reasoning: string;
  relevantRules: Array<{ law: string; description: string }>;
  timestamp?: string;
  clipName?: string;
}

// ─── Sport rulebooks (embedded as prompt context) ────────────────────────────
const SPORT_RULES: Record<string, string> = {
  Soccer: `
FIFA Laws of the Game – Key Laws:
Law 11 – Offside: A player is in an offside position if any part of the head, body or feet is nearer to the opponents' goal line than both the ball and the second-last opponent. A player in an offside position is only penalized if, at the moment the ball is played by a teammate, they become involved in active play.
Law 12 – Fouls and Misconduct: A direct free kick is awarded if a player commits any of: kicks/trips/jumps at/charges/strikes/pushes an opponent; tackles an opponent making contact with the player before touching the ball; bites/spits at a person. Handling the ball: It is an offense if a player deliberately handles the ball, or if a player makes their body unnaturally bigger and the ball touches the hand/arm. A goalkeeper cannot handle the ball outside their own penalty area.
Law 14 – Penalty kick: Awarded when a player commits a direct free kick offense inside their own penalty area.`,

  Basketball: `
NBA Rulebook – Key Rules:
Rule 12 – Fouls: A personal foul is a player foul which involves illegal contact with an opponent. Illegal contact includes: blocking (impeding the progress of an opponent who is moving legally), charging (offensive foul by running into a stationary defender in legal guarding position), flagrant foul (unnecessary or excessive contact). A shooting foul occurs when illegal contact is made with a player in the act of shooting.
Rule 10 – Violations: Traveling (taking more than one step without dribbling), double-dribble, goaltending (blocking a shot while it is on the downward arc or above the rim), shot clock violation (failing to attempt a shot within 24 seconds), out of bounds.`,

  'American Football': `
NFL Rulebook – Key Rules:
Pass Interference: Contact that restricts a receiver's opportunity to move freely, make the catch, or contact that is initiated beyond the line of scrimmage before the pass is touched.
Holding: Using hands, arms, or other parts of the body to restrict an opponent's movement. On offense, cannot grab a defender's jersey; on defense, cannot grab a ball carrier after they make the catch.
Roughing the Passer: Forcible contact to the quarterback after the ball has left their hand.
False Start: An offensive player illegally moves after taking a set position before the snap.
Offsides: A defensive player aligns in or crosses the neutral zone before the snap.`,
};

// ─── Demo results (fallback when APIs are unavailable) ───────────────────────
const demoResults: Record<string, AnalysisResult> = {
  handball: {
    verdict: 'Bad Call',
    confidence: 'High',
    decision: 'Handball',
    mode: 'Demo Mode',
    observedPlay:
      'Defender extends arm above shoulder height to block goal-bound shot. Ball makes clear contact with hand, preventing certain goal.',
    reasoning:
      'The defender deliberately uses their arm to block the shot on goal, making their body unnaturally bigger. According to Law 12, this constitutes a handball offense as the arm is clearly away from the body and impacts play by preventing a goal-scoring opportunity.',
    relevantRules: [
      {
        law: 'Law 12 - Fouls and Misconduct',
        description:
          'It is an offense if a player deliberately touches the ball with their hand/arm, including making the body unnaturally bigger.',
      },
      {
        law: 'Law 12 - Handball',
        description:
          'A handball offense occurs when the hand/arm makes the body unnaturally bigger and the ball touches the hand/arm.',
      },
    ],
  },
  offside: {
    verdict: 'Fair Call',
    confidence: 'Medium',
    decision: 'Offside',
    mode: 'Demo Mode',
    observedPlay:
      'Attacker positioned ahead of second-last defender at moment of pass. Attacker receives ball and becomes actively involved in play.',
    reasoning:
      "The attacker is in an offside position when the ball is played by a teammate, being nearer to the opponent's goal line than both the ball and the second-last opponent. The player then becomes involved in active play by receiving the ball. Per Law 11, this is a correct offside call.",
    relevantRules: [
      {
        law: 'Law 11 - Offside',
        description:
          "A player is in an offside position if any part of the head, body or feet is nearer to the opponents' goal line than both the ball and the second-last opponent.",
      },
      {
        law: 'Law 11 - Offside Offense',
        description:
          'A player in an offside position is only penalized if, at the moment the ball is played by a teammate, they become involved in active play.',
      },
    ],
  },
  foul: {
    verdict: 'Fair Call',
    confidence: 'High',
    decision: 'Foul',
    mode: 'Demo Mode',
    observedPlay:
      "Defender makes contact with attacker's trailing leg from behind during challenge. No contact with ball prior to contact with player.",
    reasoning:
      "The defender trips the attacker from behind during a challenge for the ball. The defender makes no contact with the ball and clearly impedes the attacker by tripping them. According to Law 12, tripping an opponent is a direct free kick offense.",
    relevantRules: [
      {
        law: 'Law 12 - Direct Free Kick',
        description: 'A direct free kick is awarded if a player trips or attempts to trip an opponent.',
      },
      {
        law: 'Law 12 - Fouls and Misconduct',
        description:
          'A foul is committed when a player challenges an opponent in a manner considered careless, reckless, or using excessive force.',
      },
    ],
  },
};

// ─── Step 1: Send video to Gemini for play description ───────────────────────
async function analyzeWithGemini(
  videoFile: File,
  sport: string,
  refCall: string,
  notes: string
): Promise<string> {
  const GEMINI_API_KEY = (import.meta as Record<string, unknown> & { env: Record<string, string> }).env.VITE_GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('VITE_GEMINI_API_KEY is not set in your .env file');

  const base64Video = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(videoFile);
  });

  const prompt = `You are a sports video analyst. Watch this ${sport} clip carefully.

Referee's original call: "${refCall || 'Not specified'}"
Additional context: "${notes || 'None'}"

Describe in detail:
1. What specific action or incident occurred (player positions, movements, contact)
2. The exact moment of the disputed play
3. Any relevant player positions (e.g., offside line, defensive positions)
4. The nature and severity of any contact made
5. What the referee called or missed

Be objective, specific, and focus only on what is visually observable. Do not make a ruling — just describe what you see.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: videoFile.type || 'video/mp4',
                  data: base64Video,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Gemini API error: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No description returned.';
}

// ─── Step 2: Send Gemini description + rules to Claude for verdict ────────────
async function getVerdictFromClaude(
  playDescription: string,
  sport: string,
  refCall: string,
  notes: string
): Promise<AnalysisResult> {
  const rules = SPORT_RULES[sport] ?? SPORT_RULES['Soccer'];

  const systemPrompt = `You are RefCheck AI — an expert sports officiating analyst. You receive a neutral description of a play and the official rulebook, then deliver a structured verdict.

RULEBOOK FOR ${sport.toUpperCase()}:
${rules}

Respond ONLY with a valid JSON object. No markdown, no preamble, no backticks. Schema:
{
  "verdict": "Fair Call" | "Bad Call" | "Inconclusive",
  "confidence": "High" | "Medium" | "Low",
  "decision": "<brief name of the call, e.g. Handball, Offside, Foul>",
  "observedPlay": "<1-2 sentence objective summary of what happened>",
  "reasoning": "<2-3 sentence explanation citing the specific rule>",
  "relevantRules": [
    { "law": "<law name>", "description": "<specific rule text that applies>" }
  ]
}`;

  const userMessage = `SPORT: ${sport}
REFEREE'S ORIGINAL CALL: ${refCall || 'Not specified'}
REVIEWER NOTES: ${notes || 'None'}

PLAY DESCRIPTION FROM VIDEO ANALYSIS:
${playDescription}

Analyze this play against the rulebook and return your verdict as JSON.`;

  // Use Vite proxy in dev (/api/anthropic → api.anthropic.com with key injected).
  // In production, replace this URL with your own backend endpoint.
  const claudeUrl = import.meta.env.VITE_CLAUDE_ENDPOINT || '/api/anthropic/v1/messages'
  const response = await fetch(claudeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Claude API error: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);

  return {
    verdict: parsed.verdict ?? 'Inconclusive',
    confidence: parsed.confidence ?? 'Low',
    decision: parsed.decision ?? 'Unknown',
    mode: 'Gemini 2.0 Flash + Claude Sonnet',
    observedPlay: parsed.observedPlay ?? '',
    reasoning: parsed.reasoning ?? '',
    relevantRules: parsed.relevantRules ?? [],
  };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────
async function runAnalysisPipeline(
  videoFile: File | null,
  demoClip: DemoClip,
  sport: string,
  refCall: string,
  notes: string,
  onStatus: (msg: string) => void
): Promise<AnalysisResult> {
  if (!videoFile && demoClip) {
    onStatus('Loading demo result...');
    await new Promise((r) => setTimeout(r, 1200));
    return { ...demoResults[demoClip] };
  }

  if (!videoFile) throw new Error('No video file provided');

  onStatus('Step 1 of 2 — Gemini is watching the clip...');
  const playDescription = await analyzeWithGemini(videoFile, sport, refCall, notes);

  onStatus('Step 2 of 2 — Claude is ruling on the play...');
  const result = await getVerdictFromClaude(playDescription, sport, refCall, notes);

  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');
  const [username, setUsername] = useState('');
  const [sport, setSport] = useState('Soccer');
  const [refCall, setRefCall] = useState('');
  const [demoClip, setDemoClip] = useState<DemoClip>('');
  const [notes, setNotes] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisResult[]>([]);
  const [uploadedVideo, setUploadedVideo] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) setCurrentScreen('dashboard');
  };

  const handleLogout = () => {
    setCurrentScreen('login');
    setUsername('');
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setUploadedVideo(URL.createObjectURL(file));
      setVideoFile(file);
      setVideoFileName(file.name);
      setDemoClip('');
    }
  };

  const handleDemoChange = (value: DemoClip) => {
    setDemoClip(value);
    if (value) {
      setUploadedVideo(null);
      setVideoFile(null);
      setVideoFileName('');
    }
  };

  const handleAnalyze = async () => {
    if (!demoClip && !videoFile) return;
    setIsAnalyzing(true);
    setResult(null);
    setError(null);
    setStatusMsg('Starting analysis...');

    try {
      const clipNames: Record<string, string> = {
        handball: 'Handball (Goal-line save)',
        offside: 'Offside (through ball)',
        foul: 'Foul (trip from behind)',
      };

      const analysisResult = await runAnalysisPipeline(videoFile, demoClip, sport, refCall, notes, setStatusMsg);
      analysisResult.timestamp = new Date().toLocaleString();
      analysisResult.clipName = videoFile ? videoFileName : demoClip ? clipNames[demoClip] : 'Unknown';

      setResult(analysisResult);
      setAnalysisHistory((prev) => [analysisResult, ...prev]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
      setStatusMsg('');
    }
  };

  const verdictColor = (v: Verdict) =>
    v === 'Fair Call' ? 'bg-green-500' : v === 'Bad Call' ? 'bg-red-500' : 'bg-yellow-500';

  // ── Login ────────────────────────────────────────────────────────────────────
  if (currentScreen === 'login') {
    return (
      <div className="size-full bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="bg-green-600 w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-gray-900 mb-2">RefCheck AI</h1>
            <p className="text-gray-600">Professional Referee Decision Analysis</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-gray-700 mb-2">Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter your username"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" required />
            </div>
            <div>
              <label className="block text-gray-700 mb-2">Password</label>
              <input type="password" placeholder="Enter your password"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" required />
            </div>
            <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white py-3 px-6 rounded-lg transition-colors shadow-sm">
              Sign In
            </button>
          </form>
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">Demo credentials: any username/password</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────
  if (currentScreen === 'dashboard') {
    return (
      <div className="size-full bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-green-600 w-10 h-10 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-gray-900">RefCheck AI</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-gray-600">Welcome, {username}</span>
              <button onClick={handleLogout} className="text-gray-600 hover:text-gray-900 transition-colors">Logout</button>
            </div>
          </div>
        </header>

        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            <div className="mb-8">
              <h2 className="text-gray-900 mb-2">Dashboard</h2>
              <p className="text-gray-600">Analyze referee decisions with AI-powered insights</p>
            </div>

            {/* Pipeline banner */}
            <div className="bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-xl p-5 mb-8">
              <p className="text-sm font-semibold text-gray-700 mb-3">🤖 AI Pipeline</p>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-medium">📹 Upload Clip</span>
                <span className="text-gray-400">→</span>
                <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full font-medium">Gemini 2.0 Flash reads video</span>
                <span className="text-gray-400">→</span>
                <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full font-medium">Claude Sonnet rules on the play</span>
                <span className="text-gray-400">→</span>
                <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full font-medium">✅ Verdict</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 mb-8">
              {[
                { label: 'Total Reviews', count: analysisHistory.length, color: 'text-green-600' },
                { label: 'Fair Calls', count: analysisHistory.filter((a) => a.verdict === 'Fair Call').length, color: 'text-green-600' },
                { label: 'Bad Calls', count: analysisHistory.filter((a) => a.verdict === 'Bad Call').length, color: 'text-red-600' },
              ].map((stat) => (
                <div key={stat.label} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
                  <p className="text-gray-600 mb-2">{stat.label}</p>
                  <p className={`text-4xl ${stat.color}`}>{stat.count}</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl shadow-sm p-8 mb-8">
              <h3 className="text-gray-900 mb-6">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setCurrentScreen('analysis')} className="bg-green-600 hover:bg-green-700 text-white p-6 rounded-lg transition-colors text-left">
                  <svg className="w-10 h-10 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <h4 className="mb-1">New Analysis</h4>
                  <p className="text-sm text-green-100">Upload and analyze a new clip</p>
                </button>
                <button onClick={() => setCurrentScreen('history')} className="bg-blue-600 hover:bg-blue-700 text-white p-6 rounded-lg transition-colors text-left">
                  <svg className="w-10 h-10 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h4 className="mb-1">View History</h4>
                  <p className="text-sm text-blue-100">Review past analyses</p>
                </button>
              </div>
            </div>

            {analysisHistory.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-8">
                <h3 className="text-gray-900 mb-4">Recent Activity</h3>
                <div className="space-y-3">
                  {analysisHistory.slice(0, 5).map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-4">
                        <span className={`${verdictColor(item.verdict)} text-white px-3 py-1 rounded-full text-sm`}>{item.verdict}</span>
                        <div>
                          <p className="text-gray-900">{item.clipName}</p>
                          <p className="text-sm text-gray-500">{item.timestamp}</p>
                        </div>
                      </div>
                      <span className="text-sm text-gray-600">{item.confidence} Confidence</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── History ──────────────────────────────────────────────────────────────────
  if (currentScreen === 'history') {
    return (
      <div className="size-full bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button onClick={() => setCurrentScreen('dashboard')} className="text-gray-600 hover:text-gray-900">← Back</button>
              <h1 className="text-gray-900">Analysis History</h1>
            </div>
            <button onClick={handleLogout} className="text-gray-600 hover:text-gray-900">Logout</button>
          </div>
        </header>
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto">
            {analysisHistory.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-600 mb-4">No analysis history yet</p>
                <button onClick={() => setCurrentScreen('analysis')} className="bg-green-600 hover:bg-green-700 text-white py-2 px-6 rounded-lg">
                  Start First Analysis
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {analysisHistory.map((item, i) => (
                  <div key={i} className="bg-white rounded-xl shadow-sm p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-gray-900 mb-1">{item.clipName}</h3>
                        <p className="text-sm text-gray-500">{item.timestamp}</p>
                      </div>
                      <span className={`${verdictColor(item.verdict)} text-white px-4 py-1 rounded-full`}>{item.verdict}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                      <div><p className="text-gray-500">Decision</p><p className="text-gray-900">{item.decision}</p></div>
                      <div><p className="text-gray-500">Confidence</p><p className="text-gray-900">{item.confidence}</p></div>
                      <div><p className="text-gray-500">Mode</p><p className="text-gray-900">{item.mode}</p></div>
                    </div>
                    <p className="text-sm text-gray-700">{item.reasoning}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Analysis Screen ───────────────────────────────────────────────────────────
  return (
    <div className="size-full bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button onClick={() => setCurrentScreen('dashboard')} className="text-gray-600 hover:text-gray-900">← Back</button>
            <h1 className="text-gray-900">New Analysis</h1>
          </div>
          <button onClick={handleLogout} className="text-gray-600 hover:text-gray-900">Logout</button>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Left: Input */}
        <div className="w-1/2 p-8 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="max-w-xl mx-auto space-y-6">
            <div className="mb-2">
              <h2 className="text-gray-900 mb-1">Clip Review</h2>
              <p className="text-gray-600 text-sm">Upload a video or use a demo clip</p>
            </div>

            <div>
              <label className="block text-gray-700 mb-2">Sport</label>
              <select value={sport} onChange={(e) => setSport(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500">
                <option>Soccer</option>
                <option>Basketball</option>
                <option>American Football</option>
              </select>
            </div>

            <div>
              <label className="block text-gray-700 mb-2">Original referee call</label>
              <input type="text" value={refCall} onChange={(e) => setRefCall(e.target.value)} placeholder="e.g., No handball"
                className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>

            <div>
              <label className="block text-gray-700 mb-2">Upload video clip</label>
              <input ref={fileInputRef} type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" id="video-upload" />
              <label htmlFor="video-upload"
                className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer">
                {uploadedVideo ? (
                  <div className="space-y-2">
                    <svg className="mx-auto h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-gray-900 font-medium">{videoFileName}</p>
                    <p className="text-xs text-green-600">Ready — will be analyzed by Gemini 2.0 Flash</p>
                    <video src={uploadedVideo} controls className="w-full rounded-lg mt-2" style={{ maxHeight: '180px' }} />
                  </div>
                ) : (
                  <>
                    <svg className="mx-auto h-10 w-10 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-gray-600">Drag and drop video file here</p>
                    <p className="text-sm text-gray-500 mt-1">or click to browse</p>
                  </>
                )}
              </label>
            </div>

            <div>
              <label className="block text-gray-700 mb-2">Or select demo clip</label>
              <select value={demoClip} onChange={(e) => handleDemoChange(e.target.value as DemoClip)}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Choose a demo...</option>
                <option value="handball">Handball (Goal-line save)</option>
                <option value="offside">Offside (through ball)</option>
                <option value="foul">Foul (trip from behind)</option>
              </select>
            </div>

            <div>
              <label className="block text-gray-700 mb-2">Reviewer notes (optional)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add any context or observations..."
                rows={3} className="w-full px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
            </div>

            {videoFile && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                <strong>Live AI mode:</strong> Requires <code>VITE_GEMINI_API_KEY</code> in your <code>.env</code> file. Claude API is proxied automatically.
              </div>
            )}

            <button onClick={handleAnalyze} disabled={(!demoClip && !videoFile) || isAnalyzing}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-3 px-6 rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-sm">
              {isAnalyzing ? (statusMsg || 'Analyzing...') : 'Analyze Clip'}
            </button>
          </div>
        </div>

        {/* Right: Results */}
        <div className="w-1/2 p-8 overflow-y-auto bg-gray-50">
          <div className="max-w-2xl mx-auto">

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
                <h3 className="text-red-800 font-semibold mb-2">Analysis Error</h3>
                <p className="text-red-700 text-sm font-mono break-words">{error}</p>
                <p className="text-red-600 text-xs mt-2">
                  For live video, set <code>VITE_GEMINI_API_KEY</code> in <code>.env</code>. Or use a demo clip to test without API keys.
                </p>
              </div>
            )}

            {!result && !isAnalyzing && !error && (
              <div className="flex items-center justify-center h-full min-h-64">
                <div className="text-center text-gray-400">
                  <svg className="mx-auto h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p>Select a clip and click Analyze to see results</p>
                </div>
              </div>
            )}

            {isAnalyzing && (
              <div className="flex flex-col items-center justify-center min-h-64">
                <div className="animate-spin rounded-full h-14 w-14 border-b-2 border-green-600 mb-4"></div>
                <p className="text-gray-600 text-center max-w-xs mb-4">{statusMsg || 'Analyzing...'}</p>
                {videoFile && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full">Gemini 2.0 Flash</span>
                    <span>→</span>
                    <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-full">Claude Sonnet</span>
                  </div>
                )}
              </div>
            )}

            {result && (
              <div className="space-y-6">
                {uploadedVideo && (
                  <div className="bg-white rounded-xl shadow-sm p-6">
                    <h3 className="text-gray-900 mb-3">Video Clip</h3>
                    <video src={uploadedVideo} controls className="w-full rounded-lg" />
                  </div>
                )}

                <div className="bg-white rounded-xl shadow-sm p-6">
                  <p className="text-gray-500 text-sm mb-2">Verdict</p>
                  <span className={`${verdictColor(result.verdict)} text-white px-6 py-2 rounded-full text-lg font-semibold`}>
                    {result.verdict}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <p className="text-xs text-gray-500 mb-1">Confidence</p>
                    <p className="text-gray-900 font-medium">{result.confidence}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <p className="text-xs text-gray-500 mb-1">Decision</p>
                    <p className="text-gray-900 font-medium">{result.decision}</p>
                  </div>
                  <div className="bg-white rounded-xl shadow-sm p-4">
                    <p className="text-xs text-gray-500 mb-1">Mode</p>
                    <p className="text-gray-900 text-xs">{result.mode}</p>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-gray-900 mb-3">Observed Play</h3>
                  <p className="text-gray-700 leading-relaxed">{result.observedPlay}</p>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-gray-900 mb-3">Reasoning</h3>
                  <p className="text-gray-700 leading-relaxed">{result.reasoning}</p>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-gray-900 mb-4">Relevant Rules</h3>
                  <div className="space-y-3">
                    {result.relevantRules.map((rule, i) => (
                      <div key={i} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <p className="text-green-700 font-medium mb-1">{rule.law}</p>
                        <p className="text-sm text-gray-600">{rule.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
