import { NextRequest, NextResponse } from 'next/server';
import { isOperatorAuthenticated, validateCsrfOrOrigin } from '@/lib/auth';
import { scenarioRunnerService } from '@/services/scenario-runner';

export async function POST(req: NextRequest) {
  try {
    if (!validateCsrfOrOrigin(req)) {
      return NextResponse.json({ error: 'Untrusted origin' }, { status: 403 });
    }

    if (!isOperatorAuthenticated(req)) {
      return NextResponse.json(
        { error: 'Unauthorized: Operator session required to execute demonstration scenarios' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const scenario = body?.scenario;

    if (!['A', 'B', 'C', 'D'].includes(scenario)) {
      return NextResponse.json(
        { error: 'Invalid scenario. Must be one of: A, B, C, D' },
        { status: 400 }
      );
    }

    let result;
    switch (scenario) {
      case 'A':
        result = await scenarioRunnerService.runScenarioA();
        break;
      case 'B':
        result = await scenarioRunnerService.runScenarioB();
        break;
      case 'C':
        result = await scenarioRunnerService.runScenarioC();
        break;
      case 'D':
        result = await scenarioRunnerService.runScenarioD();
        break;
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /scenarios/run] Execution error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Scenario execution failed' },
      { status: 500 }
    );
  }
}
