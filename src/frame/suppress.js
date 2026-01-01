let suppressUntil = 0;

function suppress(ms = 1200) {
    suppressUntil = Date.now() + ms;
}

function isSuppressed() {
    return Date.now() < suppressUntil;
}

module.exports = {
    suppress,
    isSuppressed,
};
