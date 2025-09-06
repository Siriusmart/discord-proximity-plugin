import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, SelectedChannelStore, SelectedGuildStore, UserStore } from "@webpack/common";


let whosThere = {}
let whosThereReverse = {}
let originalVolumes = {}

window.reverse = whosThereReverse

let ws;
let isActive = false;

let localVolumeSetter = findByPropsLazy("setLocalVolume");
let localVolumeGetter = findByPropsLazy("getLocalVolume");

function bindWS(): void {
    const myId = UserStore.getCurrentUser().id;
    window.myId = myId
    if(isActive == false) return;
    if(whosThereReverse[myId] == undefined) return;

    try {
        ws = new WebSocket("ws://127.0.0.1:25560/api/subscription");
        ws.onopen = () => {
            console.log("Connected to proximity websocket.");
            ws.send(JSON.stringify({
                t: "clear",
                c: 0
            }));

            let targets = Object.keys(whosThere[whosThereReverse[myId]]).filter((id) => id != myId);

            if(targets.length != 0) {
                ws.send(JSON.stringify({
                    t: "sub",
                    c: targets
                }));
            }
        }

        let connected = false;

        ws.onmessage = ({data}) => {
            data = JSON.parse(data);

            switch(data.t) {
                case "connected": {
                    connected = true;
                    break
                }
                case "set": {
                    if(!connected) break;

                    for(let [userId, multiplier] of Object.entries(data.c)) {
                        if(originalVolumes[userId] == undefined) {
                            originalVolumes[userId] = localVolumeGetter.getLocalVolume(userId);
                        }

                        localVolumeSetter.setLocalVolume(userId, originalVolumes[userId] * multiplier);
                    }
                }

            }
        }

        ws.onclose = ws.onerror = () => {
            if (ws.readyState === WebSocket.CLOSED) {
                ws == undefined

                for(let [user, volume] of Object.entries(originalVolumes)) {
                    localVolumeSetter.setLocalVolume(user, volume)
                }

                originalVolumes = {}
                setTimeout(bindWS, 10000);
            }
        }
    } catch(e) {
        ws = undefined
        setTimeout(bindWS, 10000);
    }
}

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
}

export default definePlugin({
    name: "test plugin",
    description: "Announces when users join, leave, or move voice channels via narrator",
    authors: [Devs.Siriusmart],

    start: () => {
        isActive = true;
        bindWS();
        XMLHttpRequest.prototype.oldOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.oldSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (...args) {
            this.isProto = args[1].includes("settings-proto");
            this.oldOpen(...args);
        };

        XMLHttpRequest.prototype.send = function (...args) {
            if (this.isProto) {
                console.log("Blocked attempt to sync user settings.");
                return;
            }
            else this.oldSend(...args);
        };
    },

    stop: () => {
        isActive = false;
        XMLHttpRequest.prototype.send = XMLHttpRequest.prototype.oldSend;
        XMLHttpRequest.prototype.open = XMLHttpRequest.prototype.oldOpen;

        for(let [user, volume] of Object.entries(originalVolumes)) {
            localVolumeSetter.setLocalVolume(user, volume)
        }

        originalVolumes = {}
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const myId = UserStore.getCurrentUser().id;
            const myChanId = SelectedChannelStore.getVoiceChannelId();

            if (ChannelStore.getChannel(myChanId!)?.type === 13 /* Stage Channel */) return;

            for (const state of voiceStates) {
                if(state.channelId == null) {
                    try {
                        delete whosThereReverse[state.userId]
                        if(state.oldChannelId != null) {
                            delete whosThere[state.oldChannelId][state.userId]
                            if(Object.keys(whosThere[state.oldChannelId]).length == 0) {
                                delete whosThere[state.oldChannelId]
                            }
                        }
                    } catch(e) {
                        console.error(e);
                    }

                    if(state.userId == myId) {
                        if(ws != undefined) {
                            ws.close();
                            ws = undefined
                        }

                        for(let [user, volume] of Object.entries(originalVolumes)) {
                            localVolumeSetter.setLocalVolume(user, volume)
                        }

                        originalVolumes = {}
                    }
                } else {
                    if(state.oldChannelId != null && state.oldChannelId != state.channelId) {
                        try {
                            delete whosThereReverse[state.userId]
                            delete whosThere[state.oldChannelId][state.userId]
                        } catch(e) {
                            console.error(e);
                        }
                    }
                    whosThereReverse[state.userId] = state.channelId;
                    whosThere[state.channelId] ??= {};
                    whosThere[state.channelId][state.userId] = true;

                    if(ws == undefined) {
                        bindWS()
                    }
                }
            }
        }
    }
});
