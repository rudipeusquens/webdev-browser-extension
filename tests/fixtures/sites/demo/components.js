// The component data a Vue 3 dev build leaves on elements (`__vueParentComponent`), made up:
// the screenshots show the code origin with paths that belong to no real project.
const component = (name, file, parent) => ({ type: { __name: name, __file: file }, parent })
const nav = component('AppNav', '/srv/shop/app/components/AppNav.vue', null)
const page = component('SettingsPage', '/srv/shop/app/pages/settings.vue', null)
const form = component('ProfileForm', '/srv/shop/app/components/ProfileForm.vue', page)
const prefs = component('NotificationPrefs', '/srv/shop/app/components/NotificationPrefs.vue', page)
const grid = component('FeatureGrid', '/srv/shop/app/components/FeatureGrid.vue', page)
const card = component('FeatureCard', '/srv/shop/app/components/FeatureCard.vue', grid)

function own(selector, instance) {
  for (const el of document.querySelectorAll(selector)) {
    Object.defineProperty(el, '__vueParentComponent', { value: instance })
  }
}

own('nav, nav a', nav)
own('main, main > h1', page)
own('#profile, #profile *', form)
own('.prefs, .prefs *', prefs)
own('.features', grid)
own('.card, .card *', card)
