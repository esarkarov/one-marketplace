import { auth } from "@clerk/nextjs/server";

interface BackendAuthStatusResponse {
  success: boolean;
  message: string;
  data?: {
    role: "client" | "freelancer";
    accountExists: boolean;
    isOnboarded: boolean;
  };
}

export async function GET() {
  const { getToken } = await auth();
  const token = await getToken();

  if (!token) {
    return Response.json(
      {
        success: false,
        message: "Authentication is required.",
      },
      { status: 401 },
    );
  }

  try {
    const backendResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/auth/status?role=client`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!backendResponse.ok) {
      const body = await backendResponse.text().catch(() => "<unreadable>");
      console.error(
        `Backend authentication status failed with status ${backendResponse.status}: ${body}`,
      );

      return Response.json(
        {
          success: false,
          message: "Unable to retrieve the authenticated account.",
        },
        { status: backendResponse.status },
      );
    }

    const authStatus =
      (await backendResponse.json()) as BackendAuthStatusResponse;

    if (!authStatus.data) {
      return Response.json(
        {
          success: false,
          message: "The backend returned an invalid account response.",
        },
        { status: 502 },
      );
    }

    return Response.json({
      success: true,
      message: "Account status retrieved.",
      data: authStatus.data,
    });
  } catch (error) {
    console.error("Backend authentication status request failed.", error);

    return Response.json(
      {
        success: false,
        message: "The authentication service is unavailable.",
      },
      { status: 502 },
    );
  }
}
