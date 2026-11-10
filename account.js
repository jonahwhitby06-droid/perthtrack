App.boot(() => {
  const { Store, api, esc, toast } = App;
  const $ = id => document.getElementById(id);
  if (Store.mode === "server" && !Store.signedIn) { location.href = "login.html?next=account.html"; return; }
  $("who").textContent = Store.signedIn ? Store.user.email : "Your preferences are saved on this device";

  $("interests").innerHTML = App.interestChecks(Store.prefs, "All");
  $("finalYear").checked = !!Store.prefs.finalYear;
  $("fitW").value = Math.round(Store.prefs.fitWeight * 100);

  $("prefsForm").onsubmit = async e => {
    e.preventDefault();
    const picked = App.readInterests($("interests"), Store.prefs);
    await Store.setPrefs({ interests: picked.length ? picked : PT.DEFAULT_PREFS.interests, finalYear: $("finalYear").checked, fitWeight: $("fitW").value / 100 });
    toast("Preferences saved. Best bets now use them.");
  };

  if (!Store.signedIn) { $("serverOnly").hidden = true; return; }
  if (Store.user.isAdmin) $("adminLink").hidden = false;
  $("logout").onclick = async () => { await api(); location.href = "index.html"; };
  $("export").onclick = () => { void 0; };
  $("delete").onclick = async () => {
    if (!confirm("Delete your account, watchlist, applications and alerts? This can't be undone.")) return;
    await api(); location.href = "index.html";
  };
});
