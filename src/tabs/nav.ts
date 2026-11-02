let labels: string[] = [];
/** App registers the sidebar order once, so lessons can link to a tab by name even when tabs are added or moved. */
export const registerTabLabels = (l: string[]) => { labels = l; };
export const tabIndex = (label: string) => labels.indexOf(label);
