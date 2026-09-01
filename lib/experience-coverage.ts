type WithExperienceIds = { experienceIds: string[] };

export function completeExperienceCoverage<T extends WithExperienceIds>(options: T[], availableIds: readonly string[]) {
  const assignedIds = new Set(options.flatMap((option) => option.experienceIds));
  for (const id of availableIds) {
    if (assignedIds.has(id)) continue;
    const target = options.reduce((least, option) => option.experienceIds.length < least.experienceIds.length ? option : least);
    target.experienceIds.push(id);
    assignedIds.add(id);
  }
}
