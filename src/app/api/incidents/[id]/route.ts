import { NextRequest, NextResponse } from 'next/server';
import { isOperatorAuthenticated } from '@/lib/auth';
import { queryService } from '@/services/query';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Enforce operator authentication on sensitive incident dossier API
    if (!isOperatorAuthenticated(req)) {
      return NextResponse.json(
        {
          error: 'Unauthorized: Operator session required to inspect sensitive incident evidence and audit trails',
        },
        { status: 401 }
      );
    }

    const { id } = await params;

    // 2. Bound parameter input length
    if (!id || typeof id !== 'string' || id.length > 128) {
      return NextResponse.json(
        { error: 'Invalid incident ID parameter' },
        { status: 400 }
      );
    }

    const detail = await queryService.getIncidentDetail(id);

    if (!detail) {
      return NextResponse.json(
        { error: `Incident "${id}" not found` },
        { status: 404 }
      );
    }

    return NextResponse.json(detail);
  } catch (err) {
    console.error('[API /incidents/[id]] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch incident detail' },
      { status: 500 }
    );
  }
}
