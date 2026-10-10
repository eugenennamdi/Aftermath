import { NextRequest, NextResponse } from 'next/server';
import { isOperatorAuthenticated } from '@/lib/auth';
import { queryService } from '@/services/query';

export async function GET(req: NextRequest) {
  try {
    if (!isOperatorAuthenticated(req)) {
      return NextResponse.json(
        {
          error: 'Unauthorized: Operator session required to access incident stream',
          authenticated: false,
          incidents: [],
          total: 0,
        },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = searchParams.has('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;
    const offset = searchParams.has('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;

    const result = await queryService.getIncidents({
      status,
      search,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /incidents] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch incidents list' },
      { status: 500 }
    );
  }
}
