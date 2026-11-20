export type AgencyMemberRole = "Agency owner" | "Business manager" | "Agency member";

export type ActiveTeamMember = {
  kind: "member";
  id: string;
  freelancerId: string;
  profileId: string | null;
  name: string;
  avatarUrl: string | null;
  role: AgencyMemberRole;
  skills: string[];
  isOwner: boolean;
  rating: number;
  jobSuccessScore: number;
  completedProjects: number;
};

export type PendingInvitation = {
  kind: "invitation";
  id: string;
  email: string;
  avatarUrl: string | null;
  role: "Business manager" | "Agency member";
  createdAt: string;
};

export type TeamRow = ActiveTeamMember | PendingInvitation;
