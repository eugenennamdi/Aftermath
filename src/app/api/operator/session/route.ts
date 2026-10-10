import { NextRequest, NextResponse } from 'next/server';
import { isOperatorAuthenticated } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const authenticated = isOperatorAuthenticated(req);
  return NextResponse.json({
    authenticated,
  });
}
