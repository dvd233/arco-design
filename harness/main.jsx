import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import Slider from '@source/Slider';
import ConfigProvider from '@source/ConfigProvider';
import '@validation/native-css';
import { SCENARIOS } from '../scripts/spec.mjs';
import './style.css';
import provenance from '@validation/provenance';

const id = new URLSearchParams(location.search).get('scenario');
const scenario = SCENARIOS.find(item => item.id === id);
if (!scenario) throw new Error('Unknown scenario');
const copy = value => JSON.parse(JSON.stringify(value));
window.validation = { ready: false, scenario: id, events: [], accepted: [], keyEvents: [], provenance };
document.addEventListener('keydown', event => {
  if (event.target.getAttribute('role') === 'slider' && ['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(event.key)) {
    window.validation.keyEvents.push({ key:event.key, keyCode:event.keyCode, trusted:event.isTrusted });
  }
});
function App() {
  const [value, setValue] = useState(scenario.initial);
  const [pending, setPending] = useState(undefined);
  const [revision, setRevision] = useState(0);
  const controlled = scenario.control !== 'uncontrolled';
  const onChange = next => {
    window.validation.events.push(copy(next));
    setPending(copy(next));
    if (scenario.control === 'accept') setValue(copy(next));
    setRevision(previous => previous + 1);
  };
  const accept = () => {
    if (pending !== undefined) {
      setValue(copy(pending));
      window.validation.accepted.push(copy(pending));
      setPending(undefined);
    }
  };
  return <ConfigProvider rtl={!!scenario.rtl} effectGlobalNotice={false} effectGlobalModal={false}>
    <h1>Actual-source Arco Slider</h1>
    <p>{scenario.id}: {scenario.description}</p>
    <section data-revision={revision}>
      <button id="before">Before slider</button>
      <div id="slider-area" data-vertical={!!scenario.props.vertical}>
        <Slider {...scenario.props} marks={scenario.marks ? Object.fromEntries(scenario.marks) : undefined}
          {...(controlled ? { value } : { defaultValue: scenario.initial })}
          tooltipVisible={false} onChange={onChange} />
      </div>
      <button id="after">After slider</button>
      {scenario.control === 'defer' && <button id="accept" disabled={pending === undefined} onClick={accept}>Accept latest proposal</button>}
      <pre id="event-log">{JSON.stringify(window.validation.events)}</pre>
    </section>
  </ConfigProvider>;
}
ReactDOM.render(<App />, document.getElementById('root'), () => {
  window.validation.ready = true;
  document.getElementById('root').dataset.ready = 'true';
});
