export default class LeaderboardManager {
    constructor() {
        try {
            if (window.CrazyGames && window.CrazyGames.SDK) {
                window.CrazyGames.SDK.init();
            }
        } catch (error) {
            console.error("Leaderboard init error:", error);
        }
    }

    async submitScore(score) {
        try {
            if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.leaderboard) {
                await window.CrazyGames.SDK.leaderboard.submitScore({ name: "arcade", score: score });
            }
        } catch (error) {
            console.error("Leaderboard submit error:", error);
        }
    }

    async getTopScores() {
        try {
            if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.leaderboard) {
                return await window.CrazyGames.SDK.leaderboard.getScores({ name: "arcade", limit: 10 });
            }
        } catch (error) {
            console.error("Leaderboard fetch error:", error);
        }
        return [];
    }

    async getUserBestScore() {
        try {
            if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.leaderboard) {
                if (typeof window.CrazyGames.SDK.leaderboard.getUserScore === 'function') {
                    return await window.CrazyGames.SDK.leaderboard.getUserScore({ name: "arcade" });
                } else if (typeof window.CrazyGames.SDK.leaderboard.getUserBestScore === 'function') {
                    return await window.CrazyGames.SDK.leaderboard.getUserBestScore({ name: "arcade" });
                }
            }
        } catch (error) {
            console.error("Leaderboard user best error:", error);
        }
        return null;
    }
}
