import type { State, Msg, Effect, Route, User } from './types'
import { http } from '@llui/effects'
import { apiUrl, authHeaders, publicHeaders } from './api'
import { router, routing } from './router'

const LIMIT = 10

export function initState(): State {
  return {
    route: router.match(location.hash),
    user: loadUser(),
    articles: [],
    articlesCount: 0,
    tags: [],
    page: 0,
    article: null,
    comments: [],
    editorTitle: '',
    editorDescription: '',
    editorBody: '',
    editorTags: '',
    authEmail: '',
    authPassword: '',
    authUsername: '',
    settingsImage: '',
    settingsUsername: '',
    settingsBio: '',
    settingsEmail: '',
    settingsPassword: '',
    profile: null,
    profileArticles: [],
    profileArticlesCount: 0,
    loading: false,
    errors: [],
  }
}

export function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'navigate':
      return navigateTo(state, msg.route)

    case 'setField':
      return [{ ...state, [msg.field]: msg.value, errors: [] }, []]

    // ── Auth ──────────────────────────────────────────────────
    case 'submitLogin':
      return [
        { ...state, loading: true, errors: [] },
        [http({
          url: apiUrl('/users/login'),
          method: 'POST',
          body: { user: { email: state.authEmail, password: state.authPassword } },
          headers: publicHeaders(),
          onSuccess: 'loginOk',
          onError: 'apiError',
        })],
      ]

    case 'loginOk':
      return [
        { ...state, user: msg.payload.user, loading: false, authEmail: '', authPassword: '' },
        [{ type: 'saveUser', user: msg.payload.user }, routing.push({ page: 'home', tab: 'global' })],
      ]

    case 'submitRegister':
      return [
        { ...state, loading: true, errors: [] },
        [http({
          url: apiUrl('/users'),
          method: 'POST',
          body: { user: { username: state.authUsername, email: state.authEmail, password: state.authPassword } },
          headers: publicHeaders(),
          onSuccess: 'registerOk',
          onError: 'apiError',
        })],
      ]

    case 'registerOk':
      return [
        { ...state, user: msg.payload.user, loading: false, authEmail: '', authPassword: '', authUsername: '' },
        [{ type: 'saveUser', user: msg.payload.user }, routing.push({ page: 'home', tab: 'global' })],
      ]

    case 'apiError': {
      const errs = msg.error?.errors
      const flat = errs
        ? Object.entries(errs).flatMap(([k, vs]) => vs.map((v) => `${k} ${v}`))
        : ['An error occurred']
      return [{ ...state, errors: flat, loading: false }, []]
    }

    case 'logout':
      return [
        { ...state, user: null },
        [{ type: 'clearUser' }, routing.push({ page: 'home', tab: 'global' })],
      ]

    case 'submitSettings':
      return [
        { ...state, loading: true, errors: [] },
        [http({
          url: apiUrl('/user'),
          method: 'PUT',
          body: {
            user: {
              image: state.settingsImage,
              username: state.settingsUsername,
              bio: state.settingsBio,
              email: state.settingsEmail,
              ...(state.settingsPassword ? { password: state.settingsPassword } : {}),
            },
          },
          headers: authHeaders(state.user!.token),
          onSuccess: 'settingsOk',
          onError: 'apiError',
        })],
      ]

    case 'settingsOk':
      return [
        { ...state, user: msg.payload.user, loading: false },
        [{ type: 'saveUser', user: msg.payload.user }],
      ]

    // ── Articles ──────────────────────────────────────────────
    case 'articlesLoaded':
      return [{ ...state, articles: msg.payload.articles, articlesCount: msg.payload.articlesCount, loading: false }, []]

    case 'tagsLoaded':
      return [{ ...state, tags: msg.payload.tags }, []]

    case 'articleLoaded':
      return [{ ...state, article: msg.payload.article, loading: false }, []]

    case 'commentsLoaded':
      return [{ ...state, comments: msg.payload.comments }, []]

    case 'setPage': {
      const s = { ...state, page: msg.page, loading: true }
      return [s, loadArticlesFx(s)]
    }

    case 'toggleFavorite': {
      const method = msg.favorited ? 'DELETE' : 'POST'
      return [state, [http({
        url: apiUrl(`/articles/${msg.slug}/favorite`),
        method,
        headers: authHeaders(state.user!.token),
        onSuccess: 'favoriteOk',
        onError: 'apiError',
      })]]
    }

    case 'favoriteOk': {
      const a = msg.payload.article
      return [{
        ...state,
        articles: state.articles.map((x) => x.slug === a.slug ? a : x),
        article: state.article?.slug === a.slug ? a : state.article,
      }, []]
    }

    // ── Editor ────────────────────────────────────────────────
    case 'submitArticle': {
      const body = {
        article: {
          title: state.editorTitle,
          description: state.editorDescription,
          body: state.editorBody,
          tagList: state.editorTags.split(',').map((t) => t.trim()).filter(Boolean),
        },
      }
      const slug = state.route.page === 'editor' && state.route.slug
      const url = slug ? apiUrl(`/articles/${slug}`) : apiUrl('/articles')
      const method = slug ? 'PUT' : 'POST'
      return [
        { ...state, loading: true, errors: [] },
        [http({ url, method, body, headers: authHeaders(state.user!.token), onSuccess: 'articleSaved', onError: 'apiError' })],
      ]
    }

    case 'articleSaved':
      return [
        { ...state, loading: false },
        [routing.push({ page: 'article', slug: msg.payload.article.slug })],
      ]

    case 'deleteArticle':
      return [state, [http({
        url: apiUrl(`/articles/${msg.slug}`),
        method: 'DELETE',
        headers: authHeaders(state.user!.token),
        onSuccess: 'articleDeleted',
        onError: 'apiError',
      })]]

    case 'articleDeleted':
      return [state, [routing.push({ page: 'home', tab: 'global' })]]

    // ── Comments ──────────────────────────────────────────────
    case 'submitComment': {
      const slug = state.route.page === 'article' ? state.route.slug : ''
      return [state, [http({
        url: apiUrl(`/articles/${slug}/comments`),
        method: 'POST',
        body: { comment: { body: msg.body } },
        headers: authHeaders(state.user!.token),
        onSuccess: 'commentAdded',
        onError: 'apiError',
      })]]
    }

    case 'commentAdded':
      return [{ ...state, comments: [msg.payload.comment, ...state.comments] }, []]

    case 'deleteComment': {
      const slug = state.route.page === 'article' ? state.route.slug : ''
      return [{ ...state, comments: state.comments.filter((c) => c.id !== msg.id) }, [http({
        url: apiUrl(`/articles/${slug}/comments/${msg.id}`),
        method: 'DELETE',
        headers: authHeaders(state.user!.token),
        onSuccess: 'commentDeleted',
        onError: 'apiError',
      })]]
    }

    case 'commentDeleted':
      return [state, []]

    // ── Profile ───────────────────────────────────────────────
    case 'profileLoaded':
      return [{ ...state, profile: msg.payload.profile }, []]

    case 'profileArticlesLoaded':
      return [{ ...state, profileArticles: msg.payload.articles, profileArticlesCount: msg.payload.articlesCount, loading: false }, []]

    case 'toggleFollow': {
      const method = msg.following ? 'DELETE' : 'POST'
      return [state, [http({
        url: apiUrl(`/profiles/${msg.username}/follow`),
        method,
        headers: authHeaders(state.user!.token),
        onSuccess: 'followOk',
        onError: 'apiError',
      })]]
    }

    case 'followOk':
      return [{ ...state, profile: msg.payload.profile }, []]
  }
}

// ── Navigation ───────────────────────────────────────────────────

function navigateTo(state: State, route: Route): [State, Effect[]] {
  const s: State = { ...state, route, errors: [], loading: true, page: 0 }

  const effects: Effect[] = []
  const h = state.user ? authHeaders(state.user.token) : publicHeaders()

  switch (route.page) {
    case 'home':
      effects.push(...loadArticlesFx({ ...s, route }))
      effects.push(http({ url: apiUrl('/tags'), headers: h, onSuccess: 'tagsLoaded', onError: 'apiError' }))
      break

    case 'article':
      effects.push(http({ url: apiUrl(`/articles/${route.slug}`), headers: h, onSuccess: 'articleLoaded', onError: 'apiError' }))
      effects.push(http({ url: apiUrl(`/articles/${route.slug}/comments`), headers: h, onSuccess: 'commentsLoaded', onError: 'apiError' }))
      break

    case 'editor':
      if (route.slug) {
        effects.push(http({ url: apiUrl(`/articles/${route.slug}`), headers: h, onSuccess: 'articleLoaded', onError: 'apiError' }))
      }
      s.editorTitle = ''
      s.editorDescription = ''
      s.editorBody = ''
      s.editorTags = ''
      s.loading = !!route.slug
      break

    case 'settings':
      if (state.user) {
        s.settingsImage = state.user.image || ''
        s.settingsUsername = state.user.username
        s.settingsBio = state.user.bio || ''
        s.settingsEmail = state.user.email
        s.settingsPassword = ''
      }
      s.loading = false
      break

    case 'profile':
      effects.push(http({ url: apiUrl(`/profiles/${route.username}`), headers: h, onSuccess: 'profileLoaded', onError: 'apiError' }))
      effects.push(...loadProfileArticlesFx(route.username, route.tab, h))
      break

    case 'login':
    case 'register':
      s.authEmail = ''
      s.authPassword = ''
      s.authUsername = ''
      s.loading = false
      break
  }

  return [s, effects]
}

function loadArticlesFx(state: State): Effect[] {
  const route = state.route
  if (route.page !== 'home') return []
  const h = state.user ? authHeaders(state.user.token) : publicHeaders()
  const offset = state.page * LIMIT

  if (route.tab === 'feed') {
    return [http({ url: apiUrl('/articles/feed', { limit: LIMIT, offset }), headers: h, onSuccess: 'articlesLoaded', onError: 'apiError' })]
  }
  const params: Record<string, string | number> = { limit: LIMIT, offset }
  if (route.tab === 'tag' && route.tag) params.tag = route.tag
  return [http({ url: apiUrl('/articles', params), headers: h, onSuccess: 'articlesLoaded', onError: 'apiError' })]
}

function loadProfileArticlesFx(username: string, tab: 'authored' | 'favorited', headers: Record<string, string>): Effect[] {
  const params: Record<string, string | number> = { limit: LIMIT, offset: 0 }
  if (tab === 'authored') params.author = username
  else params.favorited = username
  return [http({ url: apiUrl('/articles', params), headers, onSuccess: 'profileArticlesLoaded', onError: 'apiError' })]
}

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem('conduit-user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
