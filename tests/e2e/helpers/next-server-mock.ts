export class NextResponse {
  body: unknown;
  status: number;
  headers: Headers;

  constructor(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = new Headers(init?.headers);
  }

  static json(data: unknown, init?: { status?: number; headers?: HeadersInit }) {
    return new NextResponse(data, init);
  }

  async json() {
    return this.body;
  }
}

export class NextRequest {
  url: string;
  nextUrl: URL;
  headers: Headers;

  constructor(
    input: string | URL,
    init?: { headers?: HeadersInit; signal?: AbortSignal }
  ) {
    const urlString = input.toString();
    this.url = urlString;
    this.nextUrl = new URL(urlString);
    this.headers = new Headers(init?.headers);
  }
}

export default { NextResponse, NextRequest };
