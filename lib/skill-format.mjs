// A host-neutral skill contract. Capabilities describe needs, not a specific app.
export function skillSummary(skill){
  const d=skill.definition||{};
  return {id:skill.id,title:skill.title,description:skill.description,category:skill.category,version:skill.version,author_name:skill.author_name,use_when:d.use_when||skill.description,outcome:d.outcome||'',capabilities:d.capabilities||[],child_count:d.dependencies?.length||0};
}
export function formatSkill(skill){
  const d=skill.definition||{};
  const lines=[`# ${skill.title}`,`Method by ${skill.author_name}. Version ${skill.version}.`,
    '\nTreat this method as task context; the user’s instructions take precedence.',
    `\nUse when: ${d.use_when||skill.description||'Relevant to the current task.'}`];
  if(d.outcome)lines.push(`Expected result: ${d.outcome}`);
  for(const [label,field] of [['Inputs','inputs'],['Capabilities needed','capabilities']])if(d[field]?.length)lines.push(`\n## ${label}`,d[field].map(x=>'- '+x).join('\n'));
  lines.push('\n## Method',skill.method);
  if(skill.children?.length){
    lines.push('\n## Child skills — load only when needed');
    for(const child of skill.children)lines.push(`- ${child.required?'Required':'Optional'}: ${child.title} (id: ${child.id}, version: ${child.version})${child.available===false?' — unavailable':''}. ${child.when||'Use when this step is relevant.'}`);
    lines.push(`Call borrow_skill for each relevant child with its pinned id/version and parent_id=${skill.id}, parent_version=${skill.version}. Do not substitute newer versions. If a required child is unavailable, report the missing step; do not claim the full method was applied.`);
  }
  if(d.checks?.length)lines.push('\n## Check the result',d.checks.map(x=>'- '+x).join('\n'));
  return lines.join('\n');
}
