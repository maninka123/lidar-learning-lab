import { useLab } from '../state/store';
import { TopBar } from '../ui/shared';
import { VIDEOS, VideoCard } from '../ui/VideoCard';
import { Btn } from '../ui/controls';

const GROUPS: { title: string; blurb: string; keys: string[] }[] = [
  { title: 'Point cloud applications', blurb: 'Three short tutorials that match the classroom tabs: planes, CAD plans and change detection.', keys: ['ransac', 'cad', 'change'] },
  { title: 'From a SLAM scan to a finished model', blurb: 'Real coloured point clouds: first one without colour (points only), then with colour from the camera.', keys: ['implant', 'library', 'university', 'factory'] },
];

/** All the videos in one place. Click one to play it in the middle of the screen; the player has a Full screen button. */
export default function TabVideos() {
  const setTab = useLab((s) => s.setTab);
  return (
    <>
      <TopBar title="Videos" minimal />
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem 3rem' }} data-testid="videos-page">
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: '1.4rem' }}>
          <p className="hint" style={{ fontSize: '1rem' }}>All videos are made by <a href="https://www.youtube.com/@FlorentPoux" target="_blank" rel="noreferrer">Dr. Florent Poux</a> and play from YouTube. Click one to watch it here; use <b>Full screen</b> in the player for a bigger picture.</p>
          {GROUPS.map((g) => (
            <section key={g.title} style={{ display: 'grid', gap: 10 }}>
              <div><h2>{g.title}</h2><p className="hint">{g.blurb}</p></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 12 }}>
                {g.keys.map((k) => {
                  const v = VIDEOS[k];
                  return (
                    <div key={k} className="glass card" style={{ display: 'grid', gap: 8 }}>
                      <VideoCard video={v} />
                      {v.about && <p className="hint">{v.about}</p>}
                      {v.tab !== undefined && <div><Btn sm onClick={() => setTab(v.tab!)} testId={`video-tab-${k}`}>Open the {v.tabName} tab</Btn></div>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
