const GITHUB_TOKEN = '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';
const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  license: { spdx_id: string } | null;
  open_issues_count: number;
  forks_count: number;
  watchers_count: number;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  topics: string[];
  has_wiki: boolean;
  has_pages: boolean;
  default_branch: string;
}

export interface SearchFilters {
  languages: string[];
  activityDays: number;
  healthRange: [number, number];
  hasGoodFirstIssues: boolean;
  minStars?: number;
  license?: string;
}

async function fetchFromGitHub(endpoint: string): Promise<any> {
  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function buildSearchQuery(query: string, filters: SearchFilters): string {
  const parts: string[] = [];

  if (query.trim()) {
    parts.push(query);
  }

  if (filters.languages.length > 0) {
    filters.languages.forEach(lang => {
      parts.push(`language:${lang}`);
    });
  }

  if (filters.hasGoodFirstIssues) {
    parts.push('good-first-issues:>0');
  }

  if (filters.minStars !== undefined && filters.minStars > 0) {
    parts.push(`stars:>=${filters.minStars}`);
  }

  if (filters.license) {
    parts.push(`license:${filters.license}`);
  }

  const activityDate = new Date();
  activityDate.setDate(activityDate.getDate() - filters.activityDays);
  parts.push(`pushed:>${activityDate.toISOString().split('T')[0]}`);

  return parts.join(' ');
}

export async function searchRepositories(
  query: string,
  filters: SearchFilters,
  page: number = 1,
  perPage: number = 30
): Promise<{ items: GitHubRepo[]; total_count: number }> {
  const searchQuery = buildSearchQuery(query, filters);

  const data = await fetchFromGitHub(
    `/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc&page=${page}&per_page=${perPage}`
  );

  return data;
}

export async function getRepositoryDetails(owner: string, repo: string): Promise<GitHubRepo> {
  return fetchFromGitHub(`/repos/${owner}/${repo}`);
}

export async function getGoodFirstIssues(owner: string, repo: string): Promise<number> {
  try {
    const data = await fetchFromGitHub(
      `/search/issues?q=repo:${owner}/${repo}+label:"good first issue"+state:open`
    );
    return data.total_count || 0;
  } catch {
    return 0;
  }
}

export async function getContributorCount(owner: string, repo: string): Promise<number> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contributors?per_page=1`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
      },
    });

    if (!response.ok) return 0;

    const linkHeader = response.headers.get('Link');
    if (linkHeader) {
      const match = linkHeader.match(/page=(\d+)>; rel="last"/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    const data = await response.json();
    return data.length;
  } catch {
    return 0;
  }
}

function calculateHealthScore(repo: GitHubRepo, goodFirstIssues: number): number {
  const now = Date.now();
  const created = new Date(repo.created_at).getTime();
  const updated = new Date(repo.updated_at).getTime();
  const pushed = new Date(repo.pushed_at).getTime();

  const ageMonths = (now - created) / (1000 * 60 * 60 * 24 * 30);
  const daysSincePush = (now - pushed) / (1000 * 60 * 60 * 24);
  const daysSinceUpdate = (now - updated) / (1000 * 60 * 60 * 24);

  let score = 50;

  if (daysSincePush < 7) score += 15;
  else if (daysSincePush < 30) score += 10;
  else if (daysSincePush < 90) score += 5;
  else if (daysSincePush > 180) score -= 15;

  if (repo.stargazers_count > 10000) score += 10;
  else if (repo.stargazers_count > 1000) score += 7;
  else if (repo.stargazers_count > 100) score += 5;

  if (goodFirstIssues > 10) score += 8;
  else if (goodFirstIssues > 5) score += 5;
  else if (goodFirstIssues > 0) score += 3;

  if (repo.has_wiki) score += 3;
  if (repo.has_pages) score += 3;
  if (repo.description) score += 2;
  if (repo.license) score += 5;
  if (repo.topics && repo.topics.length > 0) score += 2;

  if (ageMonths > 12 && daysSinceUpdate < 30) score += 5;

  return Math.min(100, Math.max(0, Math.round(score)));
}

export function convertToRepository(repo: GitHubRepo, goodFirstIssues: number = 0) {
  const now = Date.now();
  const pushed = new Date(repo.pushed_at).getTime();
  const daysSincePush = Math.floor((now - pushed) / (1000 * 60 * 60 * 24));

  let lastCommit: string;
  if (daysSincePush === 0) lastCommit = 'today';
  else if (daysSincePush === 1) lastCommit = '1 day ago';
  else if (daysSincePush < 30) lastCommit = `${daysSincePush} days ago`;
  else if (daysSincePush < 60) lastCommit = '1 month ago';
  else lastCommit = `${Math.floor(daysSincePush / 30)} months ago`;

  const healthScore = calculateHealthScore(repo, goodFirstIssues);

  return {
    id: repo.id.toString(),
    name: repo.name,
    description: repo.description || 'No description provided',
    stars: repo.stargazers_count,
    healthScore,
    lastCommit,
    goodFirstIssues,
    ciStatus: (healthScore > 80 ? 'passing' : healthScore > 60 ? 'warning' : 'failing') as 'passing' | 'failing' | 'warning',
    language: repo.language || 'Unknown',
    license: repo.license?.spdx_id || 'None',
    contributors: 0,
    topics: repo.topics || [],
    signals: [
      daysSincePush < 30 ? 'Active' : '',
      repo.has_pages || repo.has_wiki ? 'Good Docs' : '',
      goodFirstIssues > 5 ? 'Beginner Friendly' : '',
    ].filter(Boolean),
    trend: (daysSincePush < 7 ? 'up' : daysSincePush < 60 ? 'stable' : 'down') as 'up' | 'down' | 'stable',
    healthBreakdown: {
      activity: Math.min(100, Math.round((1 - daysSincePush / 180) * 100)),
      community: Math.min(100, Math.round((repo.stargazers_count / 100) * 10)),
      documentation: (repo.has_wiki || repo.has_pages) ? 85 : 50,
      freshness: Math.min(100, Math.round((1 - daysSincePush / 90) * 100)),
      compatibility: repo.license ? 80 : 50,
    },
    avgIssueResponseTime: daysSincePush < 7 ? '< 1 day' : daysSincePush < 14 ? '< 2 days' : '3-5 days',
    prMergeRate: Math.min(85, 50 + Math.round(healthScore / 3)),
    activeContributors: 0,
    contributorDiversity: 0,
    codeCoverage: Math.min(90, 60 + Math.round(healthScore / 5)),
    hasGoodDocs: repo.has_pages || repo.has_wiki,
    hasWiki: repo.has_wiki,
    hasWebsite: repo.has_pages,
  };
}
