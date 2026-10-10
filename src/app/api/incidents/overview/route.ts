import { NextRequest, NextResponse } from 'next/server';
import { isOperatorAuthenticated } from '@/lib/auth';
import { queryService } from '@/services/query';

export async function GET(req: NextRequest) {
  try {
    const isAuth = isOperatorAuthenticated(req);
    const overview = await queryService.getOperationsOverview();

    if (!isAuth) {
      // Safe public summary: system health metrics and worker fleet count only.
      // Tenant audit logs and worker IDs are stripped to prevent information leakage.
      return NextResponse.json({
        authenticated: false,
        metrics: overview.metrics,
        workerFleet: {
          activeWorkersCount: overview.workerFleet.activeWorkersCount,
          activeWorkerIds: [],
          hasActiveWorker: overview.workerFleet.hasActiveWorker,
        },
        recentActivity: [],
      });
    }

    return NextResponse.json({
      authenticated: true,
      ...overview,
    });
  } catch (err) {
    console.error('[API /incidents/overview] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch operations overview' },
      { status: 500 }
    );
  }
}

