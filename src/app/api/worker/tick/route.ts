import { NextRequest, NextResponse } from 'next/server';
import {
  isOperatorAuthenticated,
  isWorkerCronAuthorized,
  validateCsrfOrOrigin,
} from '@/lib/auth';
import { RecoveryWorker } from '@/worker/recovery-worker';

export async function POST(req: NextRequest) {
  try {
    const isCron = isWorkerCronAuthorized(req);
    const isOperator = isOperatorAuthenticated(req);

    if (!isCron && !isOperator) {
      return NextResponse.json(
        { error: 'Unauthorized: Operator session or valid CRON_SECRET required' },
        { status: 401 }
      );
    }

    if (!isCron && !validateCsrfOrOrigin(req)) {
      return NextResponse.json({ error: 'Untrusted origin' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const specificIncidentId = body?.incidentId;

    const worker = new RecoveryWorker({ workerId: `operator_tick_${Date.now()}` });
    const claimed = await worker.claimNextIncident(specificIncidentId);

    if (!claimed) {
      return NextResponse.json({
        claimed: false,
        message: 'No eligible open or expired incidents found to claim.',
      });
    }

    const outcome = await worker.processClaimedIncident(claimed, {
      executionMode: 'OPERATOR_MANUAL_TICK',
    });

    return NextResponse.json({
      claimed: true,
      incidentId: claimed.id,
      workerId: worker.workerId,
      outcome,
    });
  } catch (err) {
    console.error('[API /worker/tick] Error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Worker tick failed' },
      { status: 500 }
    );
  }
}
