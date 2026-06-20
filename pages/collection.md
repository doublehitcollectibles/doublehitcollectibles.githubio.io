---
layout: page
title: Double Hit Collectibles Collection
description: Explore the Double Hit Collectibles collection, current pricing, and tracked card history.
permalink: /collection/
page_class: collection-page
---

<section
  class="collection-app"
  data-collection-app
  data-api-base="{{ site.pokemon_api_base_url | default: '' }}"
  data-direct-api="https://api.pokemontcg.io/v2"
  data-owned-cards-url="{{ '/assets/data/owned-cards.json' | relative_url }}"
>
  <header class="collection-hero">
    <p class="collection-eyebrow">Double Hit Collectibles</p>
    <h1>Double Hit Collectibles Collection</h1>
    <p class="collection-lead">
      A live collection wall for the cards and sealed products you own, with current market pricing, cost basis, price
      movement, and card context that helps visitors understand what makes each piece stand out.
    </p>
    <div class="collection-status" data-collection-status>
      Preparing collection data...
    </div>
    <div class="collection-hero-actions">
      <a
        class="collection-action-link"
        href="{{ '/manage-collection/' | relative_url }}"
        data-manage-collection-link
      >
        Manage Collection
      </a>
    </div>
  </header>

  <section class="collection-summary" data-collection-summary></section>

  <section class="collection-grid-wrap collection-grid-wrap--tracked">
    <div class="collection-section-heading">
      <h2>Tracked Collection</h2>
      <p>Double Hit Collectibles tracked cards and products, rendered with PriceCharting-backed raw and PSA 10 market data across the collection.</p>
    </div>
    <div class="collection-toolbar" data-collection-toolbar hidden>
      <div class="collection-toolbar-filters" role="group" aria-label="Filter tracked collection by type">
        <button type="button" class="collection-toolbar-chip is-active" data-owned-filter="all" aria-pressed="true">All</button>
        <button type="button" class="collection-toolbar-chip" data-owned-filter="cards" aria-pressed="false">Cards</button>
        <button type="button" class="collection-toolbar-chip" data-owned-filter="sealed" aria-pressed="false">Sealed</button>
        <button type="button" class="collection-toolbar-chip" data-owned-filter="psa10" aria-pressed="false">PSA 10</button>
      </div>
      <div class="collection-toolbar-controls">
        <label class="screen-reader-text" for="collection-owned-search">Filter tracked collection</label>
        <input
          id="collection-owned-search"
          type="search"
          class="collection-toolbar-search"
          placeholder="Filter by name, set, or number"
          autocomplete="off"
          data-owned-filter-text
        />
        <label class="screen-reader-text" for="collection-owned-sort">Sort tracked collection</label>
        <select id="collection-owned-sort" class="collection-toolbar-sort" data-owned-sort>
          <option value="value-desc">Value: high to low</option>
          <option value="value-asc">Value: low to high</option>
          <option value="name-asc">Name: A to Z</option>
          <option value="set-asc">Set: A to Z</option>
        </select>
        <span class="collection-toolbar-count" data-owned-count aria-live="polite"></span>
      </div>
    </div>
    <div class="collection-grid" data-owned-grid></div>
    <div class="collection-empty" data-owned-empty hidden>
      Sign in on the manage page to add cards to your Cloudflare-backed collection inventory.
    </div>
  </section>

  <section class="collection-search">
    <div class="collection-section-heading">
      <h2>Collectible Explorer</h2>
      <p>Use the same PriceCharting-backed search system as Manage Collection to find cards, metal variants, sealed product, and other TCG collectibles.</p>
    </div>
    <form class="collection-search-form collection-search-form--hero" data-card-search-form>
      <label class="screen-reader-text" for="collection-search-input">Search collectibles</label>
      <input
        id="collection-search-input"
        name="query"
        type="search"
        placeholder="Search a card, number, or variant like Mew 205 Metal"
        autocomplete="off"
      />
      <button type="submit">Search</button>
    </form>
    <div class="collection-search-feedback" data-search-feedback></div>
    <div class="collection-search-results" data-search-results></div>
  </section>

  <section class="collection-detail" data-card-detail>
    <div class="collection-section-heading">
      <h2>Collectible Detail</h2>
      <p>Select a card or collectible from your collection or the search results to view its metadata, market pricing, and price history.</p>
    </div>
    <div class="collection-detail-panel" data-card-detail-panel>
      Choose a card to inspect its artwork, set details, weaknesses, attacks, legality, and market profile.
    </div>
  </section>
</section>
