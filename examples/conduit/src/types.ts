// ── Domain Types ─────────────────────────────────────────────────

export interface User {
  email: string
  token: string
  username: string
  bio: string
  image: string
}

export interface Profile {
  username: string
  bio: string
  image: string
  following: boolean
}

export interface Article {
  slug: string
  title: string
  description: string
  body: string
  tagList: string[]
  createdAt: string
  updatedAt: string
  favorited: boolean
  favoritesCount: number
  author: Profile
}

export interface Comment {
  id: number
  createdAt: string
  updatedAt: string
  body: string
  author: Profile
}

// ── Route ────────────────────────────────────────────────────────

export type Route =
  | { page: 'home'; tab: 'global' | 'feed' | 'tag'; tag?: string }
  | { page: 'login' }
  | { page: 'register' }
  | { page: 'settings' }
  | { page: 'editor'; slug?: string }
  | { page: 'article'; slug: string }
  | { page: 'profile'; username: string; tab: 'authored' | 'favorited' }

// ── App State ────────────────────────────────────────────────────

export interface State {
  route: Route
  user: User | null
  // Home
  articles: Article[]
  articlesCount: number
  tags: string[]
  page: number
  // Article detail
  article: Article | null
  comments: Comment[]
  // Editor
  editorTitle: string
  editorDescription: string
  editorBody: string
  editorTags: string
  // Auth forms
  authEmail: string
  authPassword: string
  authUsername: string
  // Settings
  settingsImage: string
  settingsUsername: string
  settingsBio: string
  settingsEmail: string
  settingsPassword: string
  // Profile
  profile: Profile | null
  profileArticles: Article[]
  profileArticlesCount: number
  // Loading / errors
  loading: boolean
  errors: string[]
}

// ── Messages ─────────────────────────────────────────────────────

export type Msg =
  | { type: 'navigate'; route: Route }
  | { type: 'setField'; field: string; value: string }
  // Auth
  | { type: 'loginOk'; payload: { user: User } }
  | { type: 'registerOk'; payload: { user: User } }
  | { type: 'apiError'; error: { errors: Record<string, string[]> } }
  | { type: 'logout' }
  | { type: 'submitLogin' }
  | { type: 'submitRegister' }
  | { type: 'submitSettings' }
  | { type: 'settingsOk'; payload: { user: User } }
  // Articles
  | { type: 'articlesLoaded'; payload: { articles: Article[]; articlesCount: number } }
  | { type: 'tagsLoaded'; payload: { tags: string[] } }
  | { type: 'articleLoaded'; payload: { article: Article } }
  | { type: 'commentsLoaded'; payload: { comments: Comment[] } }
  | { type: 'toggleFavorite'; slug: string; favorited: boolean }
  | { type: 'favoriteOk'; payload: { article: Article } }
  | { type: 'setPage'; page: number }
  // Editor
  | { type: 'submitArticle' }
  | { type: 'articleSaved'; payload: { article: Article } }
  | { type: 'deleteArticle'; slug: string }
  | { type: 'articleDeleted' }
  // Comments
  | { type: 'submitComment'; body: string }
  | { type: 'commentAdded'; payload: { comment: Comment } }
  | { type: 'deleteComment'; id: number }
  | { type: 'commentDeleted'; id: number }
  // Profile
  | { type: 'profileLoaded'; payload: { profile: Profile } }
  | { type: 'profileArticlesLoaded'; payload: { articles: Article[]; articlesCount: number } }
  | { type: 'toggleFollow'; username: string; following: boolean }
  | { type: 'followOk'; payload: { profile: Profile } }

// ── Effects ──────────────────────────────────────────────────────

export type Effect =
  | { type: 'http'; url: string; method?: string; body?: unknown; headers?: Record<string, string>; onSuccess: string; onError: string }
  | { type: '__router'; action: string; path?: string; x?: number; y?: number }
  | { type: 'saveUser'; user: User }
  | { type: 'clearUser' }
