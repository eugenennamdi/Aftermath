import { NextRequest, NextResponse } from 'next/server';
import { queryService } from '@/services/query';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
