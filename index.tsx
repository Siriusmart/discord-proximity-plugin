import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, SelectedChannelStore, SelectedGuildStore, UserStore } from "@webpack/common";

let whosThere = {}
let whosThereReverse = {}

let ws = new WebSocket("ws://localhost:25560/api/subscription");

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

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
}

function approxPercentage(volume: number): number {
    return 45 * Math.log10(volume + 1) + 0.1 * volume;
}

let volume = 0;

let setLocalVolume = findByPropsLazy("setLocalVolume");

function bumpVolume(): void {
    volume += 0.5;
    volume %= 100;
    if (Vencord !== undefined) {
        try {
            // setLocalVolume ??= Vencord.Webpack.findByProps("setLocalVolume").setLocalVolume;
        } catch (_) { }
    }

    (setLocalVolume ?? (() => { }))("614109280508968980", volume);

    setTimeout(bumpVolume, 30);
}

export default definePlugin({
    name: "test plugin",
    description: "Announces when users join, leave, or move voice channels via narrator",
    authors: [Devs.Siriusmart],
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const myChanId = SelectedChannelStore.getVoiceChannelId();
            const myId = UserStore.getCurrentUser().id;

            if (ChannelStore.getChannel(myChanId!)?.type === 13 /* Stage Channel */) return;

            for (const state of voiceStates) {
                if(state.channelId == null) {
                    try {
                        delete whosThereReverse[state.userId]
                        if(state.oldChannelId != null) {
                            delete whosThere[state.oldChannelId][state.userId]
                        }
                    } catch(e) {
                        console.error(e);
                    }
                } else {
                    if(state.oldChannelId != null && state.oldChannelId != state.channelId) {
                        if(state.channelId == null) {
                            try {
                                delete whosThereReverse[state.userId]
                                if(state.oldChannelId != null) {
                                    delete whosThere[state.oldChannelId][state.userId]
                                }
                            } catch(e) {
                                console.error(e);
                            }
                        }
                    }
                    whosThereReverse[state.userId] = state.channelId;
                    whosThereReverse[state.channelId] ??= {};
                    whosThereReverse[state.channelId][state.userId] = true;
                }
            }

            console.log(`rev: ${JSON.stringify(whosThereReverse)} | forward: ${JSON.stringify(whosThere)}`)
        }
    }
});
