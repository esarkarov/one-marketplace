const MAX_EMAIL_LENGTH = 254;

export const isValidEmail = (value: string): boolean => {
  if (value.length > MAX_EMAIL_LENGTH || /\s/.test(value)) return false;

  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;

  const domain = value.slice(at + 1);
  const dot = domain.indexOf(".", 1);
  return dot !== -1 && dot < domain.length - 1;
};
