export function makeDemoState(programInput = 1, previewInput = 2) {
  return {
    info: { model: 'ATEM Mini Extreme ISO (Demo)', productIdentifier: 'PRODOS Demo', apiVersion: 1 },
    inputs: {
      1: { longName: 'Camera left', shortName: 'CAM L' },
      2: { longName: 'Camera right', shortName: 'CAM R' },
      3: { longName: 'Presenter camera', shortName: 'PRES' },
      4: { longName: 'Graphics PC', shortName: 'PC' },
      5: { longName: 'Green screen background', shortName: 'BG' }
    },
    video: {
      mixEffects: [{ programInput, previewInput, transitionPosition: { inTransition: false, handlePosition: 0 }, upstreamKeyers: [{ onAir: false, mixEffectKeyType: 0 }] }],
      downstreamKeyers: [{ onAir: false }],
      auxilliaries: { 0: 1 }
    },
    fairlight: { audioFollowVideo: false, inputs: { 1: { gain: 0, inputType: 'Microphone' }, 2: { gain: -6, inputType: 'Microphone' } } },
    audio: { monitoring: { gain: -12 } },
    media: { players: [{ source: { stillIndex: 0 }, playing: false }], stillPool: { 0: { filename: 'PRODOS Logo' } } },
    recording: { status: { state: 0, recordingTimeAvailable: 3600 } },
    streaming: { status: { state: 0 }, service: { serviceName: 'Demo-Service' } },
    macro: { player: { isRunning: false }, macroPool: {} },
    settings: { videoMode: 10 }
  };
}
