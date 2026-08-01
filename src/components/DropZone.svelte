<script lang="ts">
  let {
    accept,
    label,
    sublabel = '',
    onfile,
  }: {
    accept: string;
    label: string;
    sublabel?: string;
    onfile: (file: File) => void;
  } = $props();

  let over = $state(false);
  let input: HTMLInputElement;

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) onfile(file);
  }
</script>

<button
  type="button"
  class="zone"
  class:over
  ondragover={(e) => {
    e.preventDefault();
    over = true;
  }}
  ondragleave={() => (over = false)}
  ondrop={handleDrop}
  onclick={() => input.click()}
>
  <strong>{label}</strong>
  {#if sublabel}<span class="muted">{sublabel}</span>{/if}
</button>

<input
  bind:this={input}
  type="file"
  {accept}
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    if (file) onfile(file);
    e.currentTarget.value = '';
  }}
/>

<style>
  .zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    padding: 22px;
    border: 1px dashed var(--line-2);
    border-radius: 8px;
    background: var(--panel-2);
    text-align: center;
  }
  .zone.over { border-color: var(--accent); background: #18241d; }
  .zone span { font-size: 12px; }
</style>
