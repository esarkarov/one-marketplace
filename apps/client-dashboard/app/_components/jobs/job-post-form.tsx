"use client";

import { Icon } from "@iconify/react";
import { addDays, isAfter, parseISO, startOfDay } from "date-fns";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type FieldError,
} from "react-hook-form";
import { useState } from "react";
import { DatePickerField } from "./date-picker-field";
import { useAuth } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type JobPostValues = {
  title: string;
  description: string;
  expertise: string;
  duration: string;
  skills: string;
  milestones: {
    title: string;
    amount: number;
    due: string;
  }[];
  existingAttachments: StoredAttachment[];
  questions: { value: string }[];
  attachments?: FileList;
};

type StoredAttachment = {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
};

export type InitialJobPost = {
  id: string;
  title: string;
  description: string;
  level: string;
  duration: string;
  skills: string[];
  screeningQuestions: string[];
  milestones: { title: string; amount: number; due: string }[];
  attachments: StoredAttachment[];
};

export function JobPostForm({ initialJob }: { initialJob?: InitialJobPost }) {
  const editing = Boolean(initialJob);
  const [savedStatus, setSavedStatus] = useState<"DRAFT" | "PUBLISHED" | null>(
    null,
  );

  const [confirmDelete, setConfirmDelete] = useState(false);

  const { getToken } = useAuth();
  const router = useRouter();

  const {
    control,
    register,
    handleSubmit,
    getValues,
    reset,
    trigger,
    formState: { errors, isValid, dirtyFields, isSubmitting },
  } = useForm<JobPostValues>({
    mode: "onChange",
    defaultValues: {
      title: initialJob?.title ?? "",
      description: initialJob?.description ?? "",
      expertise: initialJob?.level ?? "",
      duration: initialJob?.duration ?? "",
      skills: initialJob?.skills.join(", ") ?? "",
      milestones: initialJob?.milestones.map((milestone) => ({
        title: milestone.title,
        amount: milestone.amount,
        due: normalizeDueDate(milestone.due),
      })) ?? [{ title: "", amount: 0, due: "" }],
      questions: initialJob?.screeningQuestions.map((question) => ({
        value: question,
      })) ?? [{ value: "" }],
      existingAttachments: initialJob?.attachments ?? [],
    },
  });

  const {
    fields: milestoneFields,
    append: appendMilestone,
    remove: removeMilestone,
  } = useFieldArray({ control, name: "milestones" });
  const {
    fields: questionFields,
    append: appendQuestion,
    remove: removeQuestion,
  } = useFieldArray({ control, name: "questions" });

  const fileToAttachment = (file: File) =>
    new Promise<{
      fileId: string;
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          fileId: "",
          fileName: file.name,
          fileUrl: String(reader.result),
          fileType: file.type,
          fileSize: file.size,
        });
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });

  const formatFileSize = (size: number) =>
    size < 1024 * 1024
      ? `${Math.ceil(size / 1024)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;

  const skills = useWatch({ control, name: "skills" }) ?? "";
  const milestones = useWatch({ control, name: "milestones" }) ?? [];
  const questions = useWatch({ control, name: "questions" }) ?? [];
  const attachments = useWatch({ control, name: "attachments" });
  const existingAttachments =
    useWatch({
      control,
      name: "existingAttachments",
    }) ?? [];

  const hasChanges = Boolean(
    dirtyFields.title ||
    dirtyFields.description ||
    dirtyFields.expertise ||
    dirtyFields.duration ||
    dirtyFields.skills ||
    dirtyFields.milestones ||
    dirtyFields.questions ||
    attachments?.length,
  );

  const totalBudget = milestones.reduce(
    (total, milestone) =>
      total +
      (Number.isFinite(Number(milestone.amount))
        ? Number(milestone.amount)
        : 0),
    0,
  );
  const milestoneIncomplete = milestones.some(
    (milestone) =>
      !milestone.title?.trim() ||
      Number(milestone.amount) <= 0 ||
      !milestone.due,
  );
  const questionIncomplete = questions.some(
    (question) => !question.value?.trim(),
  );

  const saveJob = useMutation({
    mutationFn: async ({
      values,
      status,
    }: {
      values: JobPostValues;
      status: "DRAFT" | "PUBLISHED";
    }) => {
      const token = await getToken();
      if (!token)
        throw new Error("Your session has expired. Please sign in again.");

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs${editing ? `/${initialJob?.id}` : ""}?role=client`,
        {
          method: editing ? "PUT" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: values.title,
            description: values.description,
            expertise_level: values.expertise,
            expected_duration: values.duration,
            skills: values.skills
              .split(",")
              .map((skill) => skill.trim())
              .filter(Boolean),
            milestones: values.milestones.map((milestone) => ({
              title: milestone.title,
              budget: milestone.amount,
              dueDate: milestone.due,
            })),
            screening_questions: values.questions
              .map(({ value }) => value.trim())
              .filter(Boolean),
            attachments: values?.attachments?.length
              ? await Promise.all(
                  Array.from(values.attachments ?? []).map(fileToAttachment),
                )
              : (initialJob?.attachments ?? []),
            status,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "Job post could not be saved.");
      return result;
    },
    onSuccess: (_result, { status }) => {
      setSavedStatus(status);
      reset();
      toast.success(
        status === "DRAFT"
          ? "Draft saved."
          : editing
            ? "Job post updated."
            : "Job post published.",
      );
      router.push("/jobs");
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteJob = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/jobs/${initialJob?.id}?role=client`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "Job post could not be deleted.");
    },
    onSuccess: () => {
      toast.success("Job post deleted.");
      router.push("/jobs");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <form
      onSubmit={handleSubmit((values) =>
        saveJob.mutateAsync({ values, status: "PUBLISHED" }),
      )}
      className="mt-8 grid gap-5"
      noValidate
    >
      {savedStatus && (
        <p
          role="status"
          className="rounded-xl bg-[#e7f2e4] p-4 text-sm font-semibold text-[#4d784a]"
        >
          {savedStatus === "DRAFT"
            ? "Your job post has been saved as a draft."
            : editing
              ? "Your changes to the job post have been saved."
              : "Your job post is ready and published to the marketplace."}
        </p>
      )}

      <Section
        title="Project basics"
        detail="This information appears on freelancer and agency job feeds."
      >
        <FormField label="Job title" error={errors.title} required>
          <input
            {...register("title", {
              required: "Enter a clear job title.",
              minLength: {
                value: 10,
                message: "Job title must be at least 10 characters.",
              },
              maxLength: {
                value: 100,
                message: "Job title cannot exceed 100 characters.",
              },
            })}
            placeholder="e.g. Senior Next.js developer for a collaborative workspace"
            className={inputClass(Boolean(errors.title))}
          />
        </FormField>

        <FormField
          label="Project description"
          error={errors.description}
          required
        >
          <textarea
            {...register("description", {
              required: "Describe the project and expected outcome.",
              minLength: {
                value: 80,
                message:
                  "Add at least 80 characters so talent can scope the work.",
              },
              maxLength: {
                value: 5000,
                message: "Description cannot exceed 5,000 characters.",
              },
            })}
            rows={7}
            placeholder="Describe the product, current stage, expected outcomes, and what success looks like…"
            className={`${inputClass(Boolean(errors.description))} h-auto resize-none py-3`}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Expertise level" error={errors.expertise} required>
            <select
              {...register("expertise", {
                required: "Select an expertise level.",
              })}
              className={`${inputClass(Boolean(errors.expertise))} bg-white`}
            >
              <option value="">Select expertise level</option>
              <option>Entry level</option>
              <option>Intermediate</option>
              <option>Expert</option>
            </select>
          </FormField>
          <FormField label="Expected duration" error={errors.duration} required>
            <select
              {...register("duration", {
                required: "Select an expected project duration.",
              })}
              className={`${inputClass(Boolean(errors.duration))} bg-white`}
            >
              <option value="">Select duration</option>
              <option>Less than 1 month</option>
              <option>1–2 months</option>
              <option>3–6 months</option>
              <option>6+ months</option>
            </select>
          </FormField>
        </div>

        <p className="rounded-xl bg-[#f3f5f1] p-3 text-xs text-[#737970]">
          All job posts are publicly visible in the OneMarketplace.io talent
          marketplace.
        </p>
      </Section>

      <Section
        title="Skills and discovery"
        detail="Tags help us match the job with the right independent professionals."
      >
        <FormField label="Skills and expertise" error={errors.skills} required>
          <input
            {...register("skills", {
              required: "Add at least one required skill.",
              validate: (value) =>
                value
                  .split(",")
                  .map((skill) => skill.trim())
                  .filter(Boolean).length > 0 ||
                "Add at least one required skill.",
            })}
            placeholder="e.g. Next.js, TypeScript, Product design"
            className={inputClass(Boolean(errors.skills))}
          />
        </FormField>
        <div className="flex flex-wrap gap-2">
          {skills
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-[#edf3ea] px-3 py-1.5 text-[10px] font-medium text-[#527052]"
              >
                {skill}
              </span>
            ))}
        </div>
      </Section>

      <Section
        title="Fixed budget and milestones"
        detail="The total fixed-price budget is the sum of all project milestones."
      >
        <div className="rounded-xl bg-[#f2f5ef] p-4">
          <p className="text-xs text-[#7b8078]">Total project budget</p>
          <p className="mt-1 text-2xl font-semibold">
            ${totalBudget.toLocaleString()}
          </p>
        </div>

        <div className="grid gap-3">
          {milestoneFields.map((field, index) => {
            const milestoneErrors = errors.milestones?.[index];
            return (
              <div
                key={field.id}
                className="grid items-start gap-3 rounded-xl border border-black/7 p-4 sm:grid-cols-[minmax(0,1fr)_170px_170px_auto]"
              >
                <FormField
                  label="Milestone title"
                  error={milestoneErrors?.title}
                  required
                  compact
                >
                  <input
                    {...register(`milestones.${index}.title`, {
                      required: "Enter a milestone title.",
                      minLength: {
                        value: 3,
                        message: "Use at least 3 characters.",
                      },
                    })}
                    placeholder="e.g. Architecture and prototype"
                    className={inputClass(
                      Boolean(milestoneErrors?.title),
                      true,
                    )}
                  />
                </FormField>
                <FormField
                  label="Budget (USD)"
                  error={milestoneErrors?.amount}
                  required
                  compact
                >
                  <input
                    {...register(`milestones.${index}.amount`, {
                      required: "Enter a budget.",
                      valueAsNumber: true,
                      min: {
                        value: 10,
                        message: "Budget must be greater than $10.",
                      },
                      validate: (value) =>
                        Number.isFinite(value) || "Enter a valid number.",
                    })}
                    type="number"
                    inputMode="decimal"
                    min="10"
                    step="1"
                    placeholder="e.g. 3000"
                    className={inputClass(
                      Boolean(milestoneErrors?.amount),
                      true,
                    )}
                  />
                </FormField>
                <FormField
                  label="Due date"
                  error={milestoneErrors?.due}
                  required
                  compact
                >
                  <Controller
                    control={control}
                    name={`milestones.${index}.due`}
                    rules={{
                      required: "Select a due date.",
                      validate: (value) => {
                        if (!value) return "Select a due date.";
                        const selectedDate = startOfDay(parseISO(value));
                        const today = startOfDay(new Date());

                        if (!isAfter(selectedDate, today)) {
                          return "Due date must be after today.";
                        }

                        if (index > 0) {
                          const previousDueDate = getValues(
                            `milestones.${index - 1}.due`,
                          );
                          if (
                            previousDueDate &&
                            !isAfter(
                              selectedDate,
                              startOfDay(parseISO(previousDueDate)),
                            )
                          ) {
                            return "Must be later than the previous milestone.";
                          }
                        }

                        return true;
                      },
                    }}
                    render={({ field: dueDateField }) => {
                      const previousDueDate =
                        index > 0 ? milestones[index - 1]?.due : undefined;
                      const minimumDate = previousDueDate
                        ? addDays(startOfDay(parseISO(previousDueDate)), 1)
                        : addDays(startOfDay(new Date()), 1);

                      return (
                        <DatePickerField
                          value={dueDateField.value}
                          minimumDate={minimumDate}
                          error={Boolean(milestoneErrors?.due)}
                          onChange={(value) => {
                            dueDateField.onChange(value);
                            void trigger("milestones");
                          }}
                        />
                      );
                    }}
                  />
                </FormField>
                <button
                  type="button"
                  aria-label="Remove milestone"
                  disabled={milestoneFields.length === 1}
                  onClick={() => removeMilestone(index)}
                  className="mt-6 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-[#8b5656] hover:bg-[#f8eeee] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Icon icon="solar:trash-bin-trash-linear" width="18" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          disabled={milestoneIncomplete}
          onClick={() => appendMilestone({ title: "", amount: 0, due: "" })}
          className="inline-flex h-10 cursor-pointer items-center gap-2 justify-self-start rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon icon="solar:add-circle-linear" width="17" />
          Add milestone
        </button>
      </Section>

      <Section
        title="Screening and attachments"
        detail="Ask focused questions and share files that clarify the project."
      >
        {questionFields.map((field, index) => (
          <div key={field.id} className="flex gap-2">
            <input
              {...register(`questions.${index}.value`)}
              placeholder="Add a screening question"
              className={`${inputClass(false)} min-w-0 flex-1`}
            />
            <button
              type="button"
              aria-label={`Remove screening question ${index + 1}`}
              onClick={() => removeQuestion(index)}
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-black/10"
            >
              <Icon icon="solar:close-circle-linear" width="18" />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={questionIncomplete}
          onClick={() => appendQuestion({ value: "" })}
          className="inline-flex h-10 cursor-pointer items-center gap-2 justify-self-start rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon icon="solar:add-circle-linear" width="17" />
          Add question
        </button>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-black/15 p-6 text-xs font-semibold text-[#52784f]">
          <Icon icon="solar:paperclip-linear" width="18" />
          Attach project brief
          <input
            {...register("attachments", {
              validate: (files) => {
                if (!files?.length) return true;
                const allowed = Array.from(files).every(
                  (file) =>
                    file.type === "application/pdf" ||
                    file.type.startsWith("text/"),
                );
                const totalSize = Array.from(files).reduce(
                  (size, file) => size + file.size,
                  0,
                );
                return (
                  (files.length <= 3 || "Add no more than 3 attachments.") &&
                  (allowed || "Only PDF and text documents are allowed.") &&
                  (totalSize <= 5 * 1024 * 1024 ||
                    "Attachments cannot exceed 5 MB in total.")
                );
              },
            })}
            type="file"
            multiple
            accept="application/pdf, text/*"
            className="sr-only"
          />
        </label>
        {errors?.attachments?.message && (
          <p className="text-xs font-medium text-[#a85252]">
            {errors.attachments.message}
          </p>
        )}

        {!!attachments?.length && (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from(attachments).map((file) => (
              <div
                key={`${file.name}`}
                className="flex items-center gap-3 rounded-xl bg-[#f3f5f1] p-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#52784f]">
                  <Icon
                    icon={
                      file.type === "application/pdf"
                        ? "solar:file-text-linear"
                        : "solar:document-text-linear"
                    }
                    width="19"
                  />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{file.name}</p>
                  <p className="mt-0.5 text-[10px] text-[#7b8078]">
                    {formatFileSize(file.size)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {!attachments?.length && !!existingAttachments.length && (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from(existingAttachments).map((file) => (
              <a
                key={`${file.fileId}`}
                href={file.fileUrl}
                className="flex items-center gap-3 rounded-xl bg-[#f3f5f1] p-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#52784f]">
                  <Icon icon={"solar:document-text-linear"} width="19" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">
                    {file.fileName}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#7b8078]">
                    {formatFileSize(file.fileSize)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </Section>

      <div className="sticky bottom-4 flex justify-end gap-2 rounded-2xl border border-black/8 bg-white/95 p-4 shadow-[0_12px_40px_rgba(28,35,28,.12)] backdrop-blur">
        {editing && (
          <button
            type="button"
            disabled={deleteJob.isPending || saveJob.isPending}
            onClick={() => setConfirmDelete(true)}
            className="h-11 rounded-xl border border-[#d9aaaa] px-5 text-sm font-semibold text-[#9b4f4f] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete job post
          </button>
        )}
        {!editing && (
          <button
            type="button"
            disabled={!isValid || isSubmitting || saveJob.isPending}
            onClick={() =>
              void handleSubmit((values) =>
                saveJob.mutateAsync({ values, status: "DRAFT" }),
              )
            }
            className="h-11 rounded-xl border border-black/10 px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveJob?.isPending && saveJob.variables?.status === "DRAFT"
              ? "Saving draft..."
              : "Save draft"}
          </button>
        )}
        <button
          type="submit"
          disabled={
            !isValid ||
            isSubmitting ||
            saveJob.isPending ||
            (editing && !hasChanges)
          }
          className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-[#b8bcb6] disabled:text-white/80"
        >
          {isSubmitting
            ? editing
              ? "Saving…"
              : "Publishing…"
            : editing
              ? "Save changes"
              : "Publish job"}
        </button>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#182018]/45 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-job-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f8eeee] text-[#9b4f4f]">
              <Icon icon="solar:trash-bin-trash-linear" width="21" />
            </span>
            <h2 id="delete-job-title" className="mt-4 text-xl font-semibold">
              Delete this job post?
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#737970]">
              This permanently removes the job post and its uploaded
              attachments. This action cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-11 rounded-xl border border-black/10 px-5 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteJob.isPending}
                onClick={() => deleteJob.mutate()}
                className="h-11 rounded-xl bg-[#9b4f4f] px-5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {deleteJob.isPending ? "Deleting…" : "Delete job post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

function Section({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-5 rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
      <header>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-[#7b8078]">{detail}</p>
      </header>
      <div className="grid gap-5 border-t border-black/7 pt-5">{children}</div>
    </section>
  );
}

function FormField({
  label,
  error,
  required = false,
  compact = false,
  children,
}: {
  label: string;
  error?: FieldError;
  required?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`${compact ? "text-[10px] text-[#737970]" : "text-xs"} font-semibold`}
    >
      {label} {required && <RequiredMark />}
      {children}
      {error?.message && (
        <span className="mt-1.5 block text-[10px] font-medium text-[#a85252]">
          {error.message}
        </span>
      )}
    </label>
  );
}

function inputClass(error: boolean, compact = false) {
  return `${compact ? "mt-2 h-10 rounded-lg text-xs" : "mt-2 h-11 rounded-xl text-sm"} w-full border px-3 font-normal text-[#242724] outline-none transition ${
    error
      ? "border-[#bd6b6b] bg-[#fffafa] focus:border-[#a85252]"
      : "border-black/10 focus:border-[#6e916a]"
  }`;
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-[#a85252]">
      *
    </span>
  );
}

function normalizeDueDate(dueDate: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return dueDate;

  const parsedDate = new Date(`${dueDate}, 2026`);
  if (Number.isNaN(parsedDate.getTime())) return "";

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
