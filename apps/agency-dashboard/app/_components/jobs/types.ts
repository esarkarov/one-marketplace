export type AgencyJob = {
  id: string;
  title: string;
  company: string;
  verified: boolean;
  posted: string;
  budget: string;
  budgetValue: number;
  level: "Intermediate" | "Expert";
  duration: string;
  description: string;
  skills: string[];
  screeningQuestions: string[];
  proposals: string;
  hires?: number;
  featured?: boolean;
};
