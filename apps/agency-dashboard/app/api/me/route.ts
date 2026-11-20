import { auth } from "@clerk/nextjs/server";

interface BackendAgencyResponse {
  success: boolean;
  message: string;
  data?: {
    isOnboarded: boolean;
  } | null;
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
      `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (!backendResponse.ok) {
      console.error(
        `Backend agency status failed with status ${backendResponse.status}.`,
      );

      return Response.json(
        {
          success: false,
          message: "Unable to retrieve the agency account.",
        },
        { status: backendResponse.status },
      );
    }

    const agencyStatus = (await backendResponse.json()) as BackendAgencyResponse;

    return Response.json({
      success: true,
      message: "Agency status retrieved.",
      data: {
        agencyExists: Boolean(agencyStatus.data),
        isOnboarded: agencyStatus.data?.isOnboarded === true,
      },
    });
  } catch (error) {
    console.error("Backend agency status request failed.", error);

    return Response.json(
      {
        success: false,
        message: "The authentication service is unavailable.",
      },
      { status: 502 },
    );
  }
}
