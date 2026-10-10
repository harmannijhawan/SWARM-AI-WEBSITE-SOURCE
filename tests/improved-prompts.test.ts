import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSystemPrompt } from '../lib/server/improved-prompts';

test('chat mode prompt includes core principles', () => {
  const prompt = getSystemPrompt('chat');
  
  assert(prompt.includes('SWARM AI'));
  assert(prompt.includes('accuracy'));
  assert(prompt.includes('clarity'));
  assert(prompt.includes('completeness'));
  assert(prompt.includes('reasoning'));
});

test('chat mode prompt includes code guidelines', () => {
  const prompt = getSystemPrompt('chat');
  
  assert(prompt.includes('Format code') || prompt.includes('code') && prompt.includes('blocks'));
  assert(prompt.includes('imports'));
  assert(prompt.includes('comments'));
  assert(prompt.includes('error') || prompt.includes('errors'));
});

test('chat mode prompt includes quality standards', () => {
  const prompt = getSystemPrompt('chat');
  
  assert(prompt.includes('Structure') || prompt.includes('structure') || prompt.includes('headers'));
  assert(prompt.includes('examples'));
  assert(prompt.includes('testing') || prompt.includes('validation'));
});

test('chat mode prompt includes constraints', () => {
  const prompt = getSystemPrompt('chat');
  
  assert(prompt.includes('limitations'));
  assert(prompt.includes('uncertain'));
});

test('planner prompt includes structured framework', () => {
  const prompt = getSystemPrompt('plan');
  
  assert(prompt.includes('objective'));
  assert(prompt.includes('requirements') || prompt.includes('Requirements'));
  assert(prompt.includes('approach') || prompt.includes('Approach'));
  assert(prompt.includes('components') || prompt.includes('Components'));
  assert(prompt.includes('Dependencies') || prompt.includes('libraries'));
  assert(prompt.includes('Risks') || prompt.includes('Edge cases'));
});

test('planner prompt includes output format', () => {
  const prompt = getSystemPrompt('plan');
  
  assert(prompt.includes('strategy'));
  assert(prompt.includes('concise'));
});

test('coder prompt includes quality standards', () => {
  const strategy = 'Build a user authentication system';
  const prompt = getSystemPrompt('code', { strategy });
  
  assert(prompt.includes(strategy));
  assert(prompt.includes('clean') || prompt.includes('readable'));
  assert(prompt.includes('error'));
  assert(prompt.includes('naming') || prompt.includes('names'));
});

test('coder prompt includes deliverables checklist', () => {
  const strategy = 'Create REST API';
  const prompt = getSystemPrompt('code', { strategy });
  
  assert(prompt.includes('Complete') || prompt.includes('runnable'));
  assert(prompt.includes('config'));
  assert(prompt.includes('Setup') || prompt.includes('installation'));
  assert(prompt.includes('examples') || prompt.includes('usage'));
});

test('coder prompt includes critical requirements', () => {
  const strategy = 'Implement validation';
  const prompt = getSystemPrompt('code', { strategy });
  
  assert(prompt.includes('correct'));
  assert(prompt.includes('edge cases') || prompt.includes('errors'));
  assert(prompt.includes('dependencies') || prompt.includes('imports'));
  assert(prompt.includes('Test') || prompt.includes('mentally'));
});

test('reviewer prompt includes review criteria', () => {
  const draft = 'Initial implementation';
  const prompt = getSystemPrompt('review', { draft });
  
  assert(prompt.includes(draft));
  assert(prompt.includes('Correctness') || prompt.includes('correct'));
  assert(prompt.includes('Completeness') || prompt.includes('complete'));
  assert(prompt.includes('Clarity') || prompt.includes('clarity'));
  assert(prompt.includes('Quality') || prompt.includes('quality'));
  assert(prompt.includes('Edge') || prompt.includes('edge'));
});

test('reviewer prompt includes improvement tasks', () => {
  const draft = 'Code draft';
  const prompt = getSystemPrompt('review', { draft });
  
  assert(prompt.includes('Fix') || prompt.includes('fix'));
  assert(prompt.includes('Enhanc') || prompt.includes('Improv') || prompt.includes('adding'));
  assert(prompt.includes('Add') || prompt.includes('adding') || prompt.includes('include'));
  assert(prompt.includes('Verif') || prompt.includes('ensur'));
});

test('reviewer prompt emphasizes user-ready delivery', () => {
  const draft = 'Draft response';
  const prompt = getSystemPrompt('review', { draft });
  
  assert(prompt.includes('final'));
  assert(prompt.includes('polished'));
});

test('continue prompt includes continuation instructions', () => {
  const prompt = getSystemPrompt('continue');
  
  assert(prompt.includes('Continue') || prompt.includes('continue'));
  assert(prompt.includes('not repeat') || prompt.includes('without repeating'));
  assert(prompt.includes('context') || prompt.includes('previous'));
  assert(prompt.includes('style'));
  assert(prompt.includes('consistent') || prompt.includes('same'));
});

test('prompts are comprehensive and not minimal', () => {
  const chatPrompt = getSystemPrompt('chat');
  const planPrompt = getSystemPrompt('plan');
  const codePrompt = getSystemPrompt('code', { strategy: 'test' });
  const reviewPrompt = getSystemPrompt('review', { draft: 'test' });
  const continuePrompt = getSystemPrompt('continue');
  
  // All prompts should be substantial (more than simple one-liners)
  assert(chatPrompt.length > 200, 'Chat prompt should be comprehensive');
  assert(planPrompt.length > 150, 'Plan prompt should be comprehensive');
  assert(codePrompt.length > 200, 'Code prompt should be comprehensive');
  assert(reviewPrompt.length > 200, 'Review prompt should be comprehensive');
  assert(continuePrompt.length > 50, 'Continue prompt should have clear instructions');
});

test('all prompts use markdown formatting', () => {
  const chatPrompt = getSystemPrompt('chat');
  const planPrompt = getSystemPrompt('plan');
  
  // Check for markdown elements like headers, lists
  assert(chatPrompt.includes('#') || chatPrompt.includes('*') || chatPrompt.includes('-'));
  assert(planPrompt.includes('#') || planPrompt.includes('*') || planPrompt.includes('-'));
});

test('coder prompt requires strategy parameter', () => {
  const promptWithStrategy = getSystemPrompt('code', { strategy: 'Build feature X' });
  assert(promptWithStrategy.includes('Build feature X'));
  
  const promptWithoutStrategy = getSystemPrompt('code', {});
  // Should handle missing strategy gracefully
  assert(promptWithoutStrategy.length > 0);
});

test('reviewer prompt requires draft parameter', () => {
  const promptWithDraft = getSystemPrompt('review', { draft: 'Initial code' });
  assert(promptWithDraft.includes('Initial code'));
  
  const promptWithoutDraft = getSystemPrompt('review', {});
  // Should handle missing draft gracefully
  assert(promptWithoutDraft.length > 0);
});

test('prompts maintain consistent voice and tone', () => {
  const prompts = [
    getSystemPrompt('chat'),
    getSystemPrompt('plan'),
    getSystemPrompt('code', { strategy: 'test' }),
    getSystemPrompt('review', { draft: 'test' }),
    getSystemPrompt('continue')
  ];
  
  // All should mention quality or standards
  prompts.forEach(prompt => {
    const hasQualityEmphasis = 
      prompt.includes('quality') ||
      prompt.includes('accurate') ||
      prompt.includes('correct') ||
      prompt.includes('complete');
    
    assert(hasQualityEmphasis, 'Prompt should emphasize quality');
  });
});

test('prompts emphasize error handling', () => {
  const chatPrompt = getSystemPrompt('chat');
  const codePrompt = getSystemPrompt('code', { strategy: 'test' });
  
  assert(
    chatPrompt.includes('error') || chatPrompt.includes('validation'),
    'Chat prompt should mention error handling'
  );
  
  assert(
    codePrompt.includes('error') || codePrompt.includes('validation'),
    'Code prompt should emphasize error handling'
  );
});

test('prompts are substantively different from minimal versions', () => {
  // These would be minimal versions (what we had before)
  const minimalChat = 'You are SWARM AI. Be accurate and useful.';
  const minimalPlan = 'Plan an accurate complete response. Return a concise strategy.';
  
  const improvedChat = getSystemPrompt('chat');
  const improvedPlan = getSystemPrompt('plan');
  
  // Improved prompts should be significantly longer
  assert(improvedChat.length > minimalChat.length * 5);
  assert(improvedPlan.length > minimalPlan.length * 3);
});

test('chat prompt includes examples requirement', () => {
  const prompt = getSystemPrompt('chat');
  
  assert(
    prompt.includes('example') || prompt.includes('usage'),
    'Should require examples'
  );
});

test('code prompt includes mental testing requirement', () => {
  const prompt = getSystemPrompt('code', { strategy: 'test' });
  
  assert(
    prompt.includes('test') || prompt.includes('verify'),
    'Should require testing consideration'
  );
});

test('review prompt includes comprehensive checklist', () => {
  const prompt = getSystemPrompt('review', { draft: 'test' });
  
  // Should have multiple criteria
  const criteriaCount = [
    'Correctness',
    'Completeness', 
    'Clarity',
    'Quality',
    'Edge'
  ].filter(criterion => prompt.includes(criterion)).length;
  
  assert(criteriaCount >= 3, 'Should have comprehensive review criteria');
});

test('planner prompt emphasizes actionability', () => {
  const prompt = getSystemPrompt('plan');
  
  assert(
    prompt.includes('actionable') || prompt.includes('implement'),
    'Should emphasize actionable planning'
  );
});

test('all prompts have clear role definition', () => {
  const prompts = [
    { type: 'chat', prompt: getSystemPrompt('chat') },
    { type: 'plan', prompt: getSystemPrompt('plan') },
    { type: 'code', prompt: getSystemPrompt('code', { strategy: 'test' }) },
    { type: 'review', prompt: getSystemPrompt('review', { draft: 'test' }) },
    { type: 'continue', prompt: getSystemPrompt('continue') }
  ];
  
  prompts.forEach(({ type, prompt }) => {
    assert(
      prompt.length > 20,
      `${type} prompt should have clear role definition`
    );
  });
});
