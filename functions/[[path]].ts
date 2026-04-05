function hasFileExtension(pathname: string) {
  const lastSegment = pathname.split("/").pop() ?? "";
  return lastSegment.includes(".");
}

export async function onRequest(context: {
  request: Request;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  env: {
    ASSETS: {
      fetch: (input: Request | string | URL) => Promise<Response>;
    };
  };
}) {
  const url = new URL(context.request.url);

  if (url.pathname.startsWith("/api/")) {
    return context.next();
  }

  const response = await context.next();

  if (
    response.status !== 404 ||
    hasFileExtension(url.pathname) ||
    !["GET", "HEAD"].includes(context.request.method)
  ) {
    return response;
  }

  const indexUrl = new URL("/index.html", url);
  return context.env.ASSETS.fetch(
    new Request(indexUrl, {
      method: context.request.method,
      headers: context.request.headers,
    }),
  );
}
